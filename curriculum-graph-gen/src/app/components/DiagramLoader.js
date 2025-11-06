"use client";

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';

const CurriculumDiagram = dynamic(() => import('./CurriculumDiagram'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center h-[80vh] bg-gray-900 rounded-lg"><p className="text-white">Loading Diagram...</p></div>,
});

export default function DiagramPage() {
  const [curricula, setCurricula] = useState([]);
  const [selectedCurriculum, setSelectedCurriculum] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchCurricula() {
      try {
        const response = await fetch('/api/curricula');
        if (!response.ok) {
          throw new Error(`Failed to fetch curricula list: ${response.statusText}`);
        }
        const data = await response.json();
        
        if (data.curricula && data.curricula.length > 0) {
            setCurricula(data.curricula);
            setSelectedCurriculum(data.curricula[0]);
        } else {
            setError("No curricula found.");
        }

      } catch (err) {
        console.error(err);
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    }
    fetchCurricula();
  }, []);

  const handleCurriculumChange = (event) => {
    const selectedId = event.target.value;
    const curriculum = curricula.find(c => c.id === selectedId);
    setSelectedCurriculum(curriculum);
  };

  return (
    <main className="container mx-auto p-4 font-sans text-white min-h-screen">
      <div className="space-y-6">
        {/* Conditionally render the diagram only when a curriculum is selected */}
        {selectedCurriculum ? (
          <CurriculumDiagram
            key={selectedCurriculum.id}
            curriculumId={selectedCurriculum.originalId || selectedCurriculum.id}
            uniqueId={selectedCurriculum.id}
            courseCode={selectedCurriculum.courseCode}
            legendPanel={
              <div className="flex flex-col items-center justify-center p-2">
                <label htmlFor="curriculum-select" className="mb-2 text-sm font-medium text-white">
                  Selecione um curso:
                </label>
                {isLoading ? (
                  <p className="text-xs text-gray-300">Carregando os cursos...</p>
                ) : error ? (
                  <p className="text-red-500 text-xs">{error}</p>
                ) : (
                  <select
                    id="curriculum-select"
                    onChange={handleCurriculumChange}
                    value={selectedCurriculum?.id || ''}
                    className="p-2 border rounded-md bg-gray-700 border-gray-600 text-white focus:ring-2 focus:ring-cyan-500 focus:outline-none w-full max-w-xs text-sm"
                  >
                    {curricula.map((curriculum) => (
                      <option key={curriculum.id} value={curriculum.id}>
                        {curriculum.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            }
          />
        ) : (
            !isLoading && <div className="text-center p-8">Please select a curriculum to display its graph.</div>
        )}
      </div>
    </main>
  );
}
