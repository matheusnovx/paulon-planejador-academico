'use client';

import { useState } from 'react';

export default function PdfUploader({ onDataReceived }) {
  const [file, setFile] = useState(null);
  const [curriculumId, setCurriculumId] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile && selectedFile.type === 'application/pdf') {
      setFile(selectedFile);
      setError(null);
    } else {
      setFile(null);
      setError('Please select a valid PDF file');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!file) {
      setError('Please select a file');
      return;
    }
    
    setIsUploading(true);
    setError(null);
    setMessage('Uploading and processing your PDF...');
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      if (curriculumId) formData.append('curriculumId', curriculumId);
      if (courseCode) formData.append('courseCode', courseCode);
      
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to upload PDF');
      }
      
      const result = await response.json();
      
      localStorage.setItem('parsedPdfData', JSON.stringify(result.data));
      
      if (onDataReceived) {
        onDataReceived(result.data);
      }
      
      setMessage('PDF successfully processed!');
      
    } catch (err) {
      console.error('Error uploading file:', err);
      setError(err.message);
      setMessage(null);
    } finally {
      setIsUploading(false);
    }
  };

return (
    <div className="bg-gray-800 p-6 rounded-lg shadow-lg">
        <h2 className="text-xl font-bold mb-4 text-white">Faça o upload do PDF de Controle de Currícular</h2>

        {error && (
            <div className="bg-red-800 text-white p-3 mb-4 rounded">
                {error}
            </div>
        )}
        
        {message && !error && (
            <div className="bg-green-800 text-white p-3 mb-4 rounded">
                {message}
            </div>
        )}
        
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label htmlFor="pdf-file" className="block mb-2 text-sm font-medium text-gray-300">
                    PDF File <span className="text-red-400">*</span>
                </label>
                <input
                    type="file"
                    id="pdf-file"
                    onChange={handleFileChange}
                    accept="application/pdf"
                    className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-gray-700 file:text-white hover:file:bg-gray-600"
                    required
                />
            </div>
            
            <button
                type="submit"
                disabled={isUploading || !file}
                className={`w-full text-white font-medium rounded-lg text-sm px-5 py-2.5 text-center ${
                    isUploading 
                        ? 'bg-blue-600 cursor-wait' 
                        : !file 
                            ? 'bg-gray-600 cursor-not-allowed'
                            : 'bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300'
                }`}
            >
                {isUploading ? 'Processing...' : 'Upload and Process'}
            </button>
        </form>
    </div>
);
}