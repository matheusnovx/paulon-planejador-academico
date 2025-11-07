import pdfplumber
import re
import json
import sys
import traceback
import io

def parse_pdf_content(pdf_source=None, pdf_bytes=None):
    """Retorna (results, output_path_or_None). Se pdf_bytes fornecido, não escreve ficheiro."""
    output_path = None

    # Extrai todo o texto do PDF
    full_text = ""
    if pdf_bytes is not None:
        fp = io.BytesIO(pdf_bytes)
        with pdfplumber.open(fp) as pdf:
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    full_text += text + "\n"
    else:
        # pdf_source espera ser um caminho
        output_path = str(pdf_source).replace(".pdf", ".json").replace(".PDF", ".json")
        with pdfplumber.open(pdf_source) as pdf:
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    full_text += text + "\n"

    # Extrai metadados do currículo
    curriculum_info = extract_curriculum_info(full_text)

    # Captura cada bloco de disciplina do código até Ob/Op
    course_pattern = re.compile(r"""
        (?P<block>                                   # Bloco completo da disciplina
            (?P<codigo>[A-Z]{2,}[A-Z]?\d{4})         # Código (ex: ARQ5621, FSARQ5631)
            .*?                                      # Nome, carga, nota, etc.
            (?P<tipo>Ob|Op)\b                        # Tipo (Ob/Op)
        )
    """, re.VERBOSE)

    results = {
        "cursadas": [],
        "andamento": [],
        "dispensadas": []
    }

    # Adiciona metadados
    if curriculum_info:
        results.update(curriculum_info)

    processed_courses = set()

    # Processa linha por linha
    for line in full_text.splitlines():
        line = line.strip()
        if not line:
            continue

        # Procura TODAS as disciplinas (cada bloco) na linha
        for match in course_pattern.finditer(line):
            data = match.groupdict()
            codigo = data["codigo"]
            tipo = data["tipo"]
            block = data["block"]

            if codigo in processed_courses:
                continue
            processed_courses.add(codigo)

            # Determina status pela análise do bloco específico
            if "Cursando" in block:
                results["andamento"].append({"codigo": codigo, "tipo": tipo})
            elif "Cursou Eqv" in block or "Equivalência" in block:
                results["dispensadas"].append({"codigo": codigo, "tipo": tipo})
            elif "Não Cursou" in block or "Reprovado" in block:
                # Ignorar ou poderia guardar em "naoCursadas"
                continue
            elif re.search(r'\d{4}/\d\s+\d+\.\d', block):
                results["cursadas"].append({"codigo": codigo, "tipo": tipo})

    if output_path:
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)

    return results, output_path


def extract_curriculum_info(text):
    """Extrai metadados do currículo do texto do PDF"""
    info = {}

    # Código do curso
    course_match = re.search(r'Curso:\s*(\d{3})', text)
    if course_match:
        info["courseCode"] = course_match.group(1)

    # Curriculum ID (YYYY/N → YYYYN)
    curriculum_match = re.search(r'Curr[ií]culo:\s*(\d{4}/\d)', text, re.IGNORECASE)
    if curriculum_match:
        info["curriculumId"] = curriculum_match.group(1).replace("/", "")

    def parse_number(s):
        if not s:
            return None
        s = s.strip().replace(".", "").replace(",", ".")
        try:
            return float(s) if "." in s else int(s)
        except:
            return None

    # Numero Aulas (semanal)
    weekly_match = re.search(r'Numero\s*Aulas\s*\(semanal\)\s*[:\-\s]*([\d.,]+)', text, re.IGNORECASE)
    if weekly_match:
        info["minClasses"] = parse_number(weekly_match.group(1))

    # Aulas Mínimas
    min_match = re.search(r'Aulas\s*M[ií]nimas\s*[:\-\s]*([\d.,]+)', text, re.IGNORECASE)
    if min_match:
        info["minClasses"] = parse_number(min_match.group(1))

    # Aulas Média
    avg_match = re.search(r'Aulas\s*M[eé]dia\s*[:\-\s]*([\d.,]+)', text, re.IGNORECASE)
    if avg_match:
        info["avgClasses"] = parse_number(avg_match.group(1))

    # Aulas Máximas
    max_match = re.search(r'Aulas\s*M[aá]xima?s?\s*[:\-\s]*([\d.,]+)', text, re.IGNORECASE)
    if max_match:
        info["maxClasses"] = parse_number(max_match.group(1))

    return info


if __name__ == "__main__":
    try:
        # Modo stdin: se nenhum argumento, lê bytes do stdin e escreve JSON no stdout (apenas JSON)
        if len(sys.argv) < 2:
            pdf_bytes = sys.stdin.buffer.read()
            if not pdf_bytes:
                # sem dados no stdin -> erro
                print("No PDF data received on stdin", file=sys.stderr)
                sys.exit(1)
            results, _ = parse_pdf_content(pdf_bytes=pdf_bytes)
            # só imprime JSON (sem logs extra)
            print(json.dumps(results, ensure_ascii=False))
            sys.exit(0)
        else:
            pdf_path = sys.argv[1]
            # prints informativos vão para stderr (não poluem stdout)
            print(f"Processing PDF: {pdf_path}", file=sys.stderr)
            results, output_path = parse_pdf_content(pdf_source=pdf_path)
            print(f"Output will be saved to: {output_path}", file=sys.stderr)
            print(f"saved to: {output_path}", file=sys.stderr)
            sys.exit(0)
    except Exception as e:
        print(f"Unexpected error: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
