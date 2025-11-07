import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';

const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    
    const userProvidedCurriculumId = formData.get('curriculumId');
    const userProvidedCourseCode = formData.get('courseCode');
    
    if (!file) {
      return NextResponse.json(
        { error: 'No file uploaded' },
        { status: 400 }
      );
    }

    const fileName = file.name.toLowerCase();
    if (!fileName.includes('.pdf')) {
      return NextResponse.json(
        { error: 'Only PDF files are accepted' },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    
    // --- begin replacement: don't write file to disk, stream to python stdin ---
    const pythonScript = path.join(process.cwd(), 'src', 'app', 'lib', 'parsers', 'pdf_parser.py');
    
    if (!fs.existsSync(pythonScript)) {
      console.error(`Python script not found at: ${pythonScript}`);
      return NextResponse.json(
        { error: 'Parser script not found' },
        { status: 500 }
      );
    }

    const py = spawn('python3', [pythonScript], { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    py.stdout.on('data', (data) => { stdout += data.toString(); });
    py.stderr.on('data', (data) => { stderr += data.toString(); });

    py.on('error', (err) => {
      console.error('Failed to start python:', err);
    });

    await new Promise((resolve, reject) => {
      py.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(`Python exited with code ${code}: ${stderr}`));
        }
        resolve();
      });
      // envia o PDF binário para o stdin do script Python
      py.stdin.write(buffer);
      py.stdin.end();
    });

    // REMOVIDA a verificação que tratava qualquer conteúdo em stderr como erro.
    // Se o processo saiu com código 0, prosseguimos — mensagens de log em stderr são permitidas.

    let parsedData;
    try {
      parsedData = JSON.parse(stdout);
    } catch (e) {
      console.error('Invalid JSON from parser:', e, 'raw stdout:', stdout);
      return NextResponse.json(
        { error: 'Parser returned invalid JSON' },
        { status: 500 }
      );
    }
    // --- end replacement ---

    if (userProvidedCurriculumId) {
      parsedData.curriculumId = userProvidedCurriculumId;
    }
    
    if (userProvidedCourseCode) {
      parsedData.courseCode = userProvidedCourseCode;
    }
    
    if (!parsedData.curriculumId) {
      console.warn("Could not extract curriculum ID from PDF, using default");
      parsedData.curriculumId = "20071";
    }
    
    if (!parsedData.courseCode) {
      console.warn("Could not extract course code from PDF, using default");
      parsedData.courseCode = "208";
    }
    
    return NextResponse.json({
      success: true,
      message: 'PDF successfully processed',
      data: parsedData
    });
    
  } catch (error) {
    console.error('Error handling file upload:', error);
    return NextResponse.json(
      { error: `Failed to process the uploaded file: ${error.message}` },
      { status: 500 }
    );
  }
}