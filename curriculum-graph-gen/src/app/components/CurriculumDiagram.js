'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import ReactFlow, { Controls, Background, MiniMap, Panel } from 'reactflow';
import 'reactflow/dist/style.css';
import CourseNode from './CourseNode';
import { organizeGraphLayout } from '../utils/graphLayout';

const nodeTypes = {
  course: CourseNode,
};

// Style definitions
const defaultEdgeStyle = {
  stroke: '#667',
  strokeWidth: 2,
};
const highlightedEdgeStyle = {
  stroke: '#00bfff',
  strokeWidth: 3,
};

// Course status styles
const completedCourseStyle = {
  background: '#2d6a4f',
  border: '2px solid #40916c',
};

const inProgressCourseStyle = {
  background: '#774936',
  border: '2px solid #ca6702',
};

const pendingCourseStyle = {
  background: '#222',
  border: '1px solid #666',
};

export default function CurriculumDiagram({ 
  curriculumId, 
  courseCode, 
  studentProgress, 
  onTotalCoursesUpdate,
  legendPanel,
  tipPanel
}) {
  const [showLegendPanel, setShowLegendPanel] = useState(true);
  const [showTipPanel, setShowTipPanel] = useState(true);
  
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [highlightedIds, setHighlightedIds] = useState(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedNodeInfo, setSelectedNodeInfo] = useState(null);
  const [showNodeInfo, setShowNodeInfo] = useState(false);

  const [activeHighlightType, setActiveHighlightType] = useState(null);

  const courseStatusMap = React.useMemo(() => {
    if (!studentProgress) return {};
    
    const statusMap = {};
    
    studentProgress.cursadas.forEach(course => {
      statusMap[course.codigo] = { status: 'completed' };
    });
    
    studentProgress.andamento.forEach(course => {
      statusMap[course.codigo] = { status: 'in_progress' };
    });
    
    studentProgress.dispensadas.forEach(course => {
      statusMap[course.codigo] = { 
        status: 'completed',
        equivalence: true 
      };
    });
    
    return statusMap;
  }, [studentProgress]);

  useEffect(() => {
    if (!curriculumId || !courseCode) return;

    async function fetchGraphData() {
      setLoading(true);
      setError(null);
      try {
        const apiUrl = `/api/graph?id=${curriculumId}&courseCode=${courseCode}`;
        const response = await fetch(apiUrl);

        if (!response.ok) {
          throw new Error(`Failed to fetch graph data: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        const layoutedNodes = organizeGraphLayout(data.nodes || [], data.edges || []);
        setNodes(layoutedNodes);
        
        setEdges(data.edges || []);
        setHighlightedIds(new Set());

      } catch (err) {
        console.error("Failed to fetch graph data:", err);
        setError(err.message);
        setNodes([]);
        setEdges([]);
      } finally {
        setLoading(false);
      }
    }

    fetchGraphData();
  }, [curriculumId, courseCode]);

  const clickTimeoutRef = useRef(null);
  const isProcessingClick = useRef(false);

  const handleNodeSelection = useCallback((event, node) => {
    setSelectedNodeInfo({
      id: node.id,
      label: node.data.labelNome,
      description: node.description,
      workloadHours: node.workloadHours,
      suggestedSemester: node.suggestedSemester,
      status: node.data.status,
      equivalence: node.data.equivalence,
      hasPrerequisites: node.data.hasPrerequisites,
      hasPostRequisites: node.data.hasPostRequisites,
    });
    
    setShowNodeInfo(true);
    setSelectedNodeId(node.id);
  }, []);

  const handlePathHighlighting = useCallback(async (node) => {
    if (activeHighlightType === 'postrequisites') {
      setHighlightedIds(new Set());
      setActiveHighlightType(null);
      return;
    }
    
    setHighlightedIds(new Set());
    
    setError(null);
    try {
      const apiUrl = `/api/graph/path/${node.id}?curriculumId=${curriculumId}&courseCode=${courseCode}`;
      const response = await fetch(apiUrl);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response.' }));
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      setHighlightedIds(new Set(data.highlightedIds));
      setActiveHighlightType('postrequisites');
    } catch (err) {
      console.error("Failed to fetch path:", err);
      setError(`Failed to fetch path: ${err.message}`);
    }
  }, [curriculumId, courseCode, activeHighlightType]);

  const handlePrerequisitesHighlighting = useCallback(async (node) => {
    if (activeHighlightType === 'prerequisites') {
      setHighlightedIds(new Set());
      setActiveHighlightType(null);
      return;
    }
    
    setHighlightedIds(new Set());
    
    setError(null);
    try {
      const apiUrl = `/api/graph/prerequisites/${node.id}?curriculumId=${curriculumId}&courseCode=${courseCode}`;
      const response = await fetch(apiUrl);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to parse error response.' }));
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      setHighlightedIds(new Set(data.highlightedIds));
      setActiveHighlightType('prerequisites');
    } catch (err) {
      console.error("Failed to fetch prerequisites:", err);
      setError(`Failed to fetch prerequisites: ${err.message}`);
    }
  }, [curriculumId, courseCode, activeHighlightType]);

  const onNodeDoubleClick = useCallback((event, node) => {
    // Prevent the single click from also triggering
    event.preventDefault();
    event.stopPropagation();
    
    if (isProcessingClick.current) return;
    isProcessingClick.current = true;
    
    if (activeHighlightType === 'both') {
      setHighlightedIds(new Set());
      setActiveHighlightType(null);
      
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = setTimeout(() => {
        isProcessingClick.current = false;
      }, 300);
      return;
    }
    
    setHighlightedIds(new Set());
    setError(null);
    
    const fetchBothPaths = async () => {
      try {
        const preReqUrl = `/api/graph/prerequisites/${node.id}?curriculumId=${curriculumId}&courseCode=${courseCode}`;
        const postReqUrl = `/api/graph/path/${node.id}?curriculumId=${curriculumId}&courseCode=${courseCode}`;
        
        const [preReqResponse, postReqResponse] = await Promise.all([
          fetch(preReqUrl),
          fetch(postReqUrl)
        ]);
        
        if (!preReqResponse.ok || !postReqResponse.ok) {
          throw new Error("Failed to fetch course relationships");
        }
        
        const preReqData = await preReqResponse.json();
        const postReqData = await postReqResponse.json();
        
        const combinedIds = new Set([
          ...preReqData.highlightedIds,
          ...postReqData.highlightedIds
        ]);
        
        setHighlightedIds(combinedIds);
        setActiveHighlightType('both');
        
        if (selectedNodeId !== node.id) {
          setSelectedNodeInfo({
            id: node.id,
            label: node.data.labelNome,
            description: node.description,
            workloadHours: node.workloadHours,
            suggestedSemester: node.suggestedSemester,
            status: node.data.status,
            equivalence: node.data.equivalence,
            hasPrerequisites: node.data.hasPrerequisites,
            hasPostRequisites: node.data.hasPostRequisites
          });
          setShowNodeInfo(true);
          setSelectedNodeId(node.id);
        }
      } catch (err) {
        console.error("Failed to fetch course relationships:", err);
        setError(`Failed to fetch course relationships: ${err.message}`);
      } finally {
        clearTimeout(clickTimeoutRef.current);
        clickTimeoutRef.current = setTimeout(() => {
          isProcessingClick.current = false;
        }, 300);
      }
    };
    
    fetchBothPaths();
    
  }, [curriculumId, courseCode, activeHighlightType, selectedNodeId]);

  const onNodeClick = useCallback((event, node) => {
    if (isProcessingClick.current) return;
    
    isProcessingClick.current = true;
    
    if (selectedNodeId === node.id) {
      handlePathHighlighting(node);
    } else {
      handleNodeSelection(event, node);
    }
    
    clearTimeout(clickTimeoutRef.current);
    clickTimeoutRef.current = setTimeout(() => {
      isProcessingClick.current = false;
    }, 300);
  }, [selectedNodeId, handlePathHighlighting, handleNodeSelection]);

  useEffect(() => {
    return () => {
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
      }
    };
  }, []);

  const closeInfo = useCallback(() => {
    setShowNodeInfo(false);
    setSelectedNodeId(null);
    setHighlightedIds(new Set());
    setActiveHighlightType(null);
  }, []);

  const onPaneClick = useCallback(() => {
    closeInfo();
    setHighlightedIds(new Set());
    setActiveHighlightType(null);
  }, [closeInfo]);

  const enhancedNodes = React.useMemo(() => {
    if (!nodes.length || Object.keys(courseStatusMap).length === 0) {
      return nodes;
    }
    
    return nodes.map(node => {
      const courseInfo = courseStatusMap[node.id];
      if (!courseInfo) {
        return node;
      }
      
      return {
        ...node,
        data: {
          ...node.data,
          status: courseInfo.status,
          equivalence: courseInfo.equivalence
        }
      };
    });
  }, [nodes, courseStatusMap]);

  // First, create sets to track which courses have pre and post requisites
  const coursesWithPrerequisites = new Set();
  const coursesWithPostRequisites = new Set();

  // When processing edges, update these sets
  edges.forEach(edge => {
    coursesWithPostRequisites.add(edge.source);
    coursesWithPrerequisites.add(edge.target);
  });

  // Apply highlighting and styling to nodes
  const nodesWithHighlight = React.useMemo(() => enhancedNodes.map(node => {
    let nodeStyle = pendingCourseStyle;
    if (node.data.status === 'completed') {
      nodeStyle = completedCourseStyle;
    } else if (node.data.status === 'in_progress') {
      nodeStyle = inProgressCourseStyle;
    }
    
    return {
      ...node,
      data: {
        ...node.data,
        isHighlighted: highlightedIds.has(node.id),
        isSelected: node.id === selectedNodeId,
        style: nodeStyle,
        hasPrerequisites: coursesWithPrerequisites.has(node.id),
        hasPostRequisites: coursesWithPostRequisites.has(node.id)
      }
    };
  }), [enhancedNodes, highlightedIds, selectedNodeId, coursesWithPrerequisites, coursesWithPostRequisites]);

  const edgesWithHighlight = React.useMemo(() => edges.map(edge => {
    const isHighlighted = highlightedIds.has(edge.source) && highlightedIds.has(edge.target);
    return {
      ...edge,
      animated: isHighlighted,
      style: isHighlighted ? highlightedEdgeStyle : defaultEdgeStyle,
    };
  }), [edges, highlightedIds]);

  const progressStats = React.useMemo(() => {
    if (!studentProgress) return null;
    
    const completed = studentProgress.cursadas.length + studentProgress.dispensadas.length;
    const inProgress = studentProgress.andamento.length;
    const total = nodes.length;
    const pending = total - completed - inProgress;
    
    return {
      completed,
      inProgress,
      pending,
      total,
      completionPercentage: Math.round((completed / total) * 100)
    };
  }, [studentProgress, nodes.length]);

  useEffect(() => {
    if (nodes.length > 0 && onTotalCoursesUpdate) {
      onTotalCoursesUpdate(nodes.length);
    }
  }, [nodes.length, onTotalCoursesUpdate]);

  return (
    <div className="w-full h-[80vh] border border-gray-700 rounded-lg bg-gray-900">
      <ReactFlow
        nodes={nodesWithHighlight}
        edges={edgesWithHighlight}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        nodeTypes={nodeTypes}
        onPaneClick={onPaneClick}
        fitView
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
      >
        <Controls showInteractive={false} />
        <Background color="#333" gap={16} />

        {/* Escolher curso para ver o curriculo */}
        {legendPanel && (
          <Panel position="top-right">
            {legendPanel}
          </Panel>
        )}
        
        {loading && <Panel position="top-center"><div className="p-2 bg-gray-700 rounded">Carregando...</div></Panel>}
        {error && <Panel position="top-center"><div className="p-2 bg-red-800 text-white rounded">Erro: {error}</div></Panel>}
        
        {/* Painel de dicas*/}
        <Panel position="bottom-right">
          {showTipPanel ? (
            <div className="bg-gray-800 rounded shadow-lg overflow-hidden p-2 flex items-center min-w-[220px] transition-all duration-200">
              <span className="text-[12px] text-gray-200">
                <span className="font-semibold">Dica:</span> Clique em uma disciplina para ver detalhes.
              </span>
              <button
                className="ml-2 flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-gray-700 hover:bg-blue-600 transition-colors"
                onClick={() => setShowTipPanel(false)}
                aria-label="Minimizar dicas"
                type="button"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            </div>
          ) : (
            <button
              className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-700 hover:bg-blue-600 shadow-lg transition-colors"
              onClick={() => setShowTipPanel(true)}
              aria-label="Mostrar dicas"
              type="button"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none"/>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 16v-4m0-4h.01" />
              </svg>
            </button>
          )}
        </Panel>

        {showNodeInfo && selectedNodeInfo && (
          <Panel position="top-right">
            <div className="p-4 bg-gray-800 text-white rounded-lg shadow-lg max-w-md">
              <div className="flex justify-between items-start">
                <h3 className="font-bold text-lg flex items-center gap-2">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-7 w-7 text-blue-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    title="Mais informações"
                  >
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none"/>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 16v-4m0-4h.01" />
                  </svg>
                  {selectedNodeInfo.label}
                </h3>
                <button 
                  onClick={closeInfo}
                  className="bg-transparent border-none text-gray-400 hover:text-white"
                >
                  ✕
                </button>
              </div>
              <div className="mt-2">
                {selectedNodeInfo.description && (
                  <p className="text-sm mt-2">
                    <span className='font-semibold'>Descrição:</span> {selectedNodeInfo.description}
                  </p>
                )}
                {selectedNodeInfo.workloadHours && (
                  <p className="mt-3 text-sm">
                    <span className="font-semibold">Carga Horária:</span> {selectedNodeInfo.workloadHours}h
                  </p>
                )}
                {selectedNodeInfo.suggestedSemester && (
                  <p className="mt-1 text-sm">
                    <span className="font-semibold">Semestre Sugerido:</span> {selectedNodeInfo.suggestedSemester}
                  </p>
                )}
                {selectedNodeInfo.status && (
                  <div className="mt-2 p-2 rounded" style={{ 
                    backgroundColor: selectedNodeInfo.status === 'completed' ? '#2d6a4f' : 
                                    selectedNodeInfo.status === 'in_progress' ? '#774936' : 
                                    '#333' 
                  }}>
                    <p className="text-sm font-bold">
                      Status: {selectedNodeInfo.status === 'completed' ? 'Concluída' : 
                              selectedNodeInfo.status === 'in_progress' ? 'Em Andamento' : 
                              'Pendente'}
                      {selectedNodeInfo.equivalence ? ' (Equivalência)' : ''}
                    </p>
                  </div>
                )}
                
                {/* Botões para destacar caminhos */}
                <div className="mt-4 flex space-x-2">
                  {selectedNodeInfo.hasPrerequisites && (
                    <button 
                      onClick={() => handlePrerequisitesHighlighting({id: selectedNodeInfo.id})}
                      className="flex-1 px-3 py-2 bg-blue-700 hover:bg-blue-800 rounded text-white text-xs flex items-center justify-center"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                      </svg>
                      {activeHighlightType === 'prerequisites' ? "Ocultar" : "Pré-requisitos"}
                    </button>
                  )}
                  {selectedNodeInfo.hasPostRequisites && (
                    <button 
                      onClick={() => handlePathHighlighting({id: selectedNodeInfo.id})}
                      className="flex-1 px-3 py-2 bg-blue-700 hover:bg-blue-800 rounded text-white text-xs flex items-center justify-center"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                      </svg>
                      {activeHighlightType === 'postrequisites' ? "Ocultar" : "Pós-requisitos"}
                    </button>
                  )}
                </div>

                {/* Adicionar botão para limpar todos os destaques quando ambos estiverem ativos */}
                {activeHighlightType === 'both' && (
                  <button 
                    onClick={() => {
                      setHighlightedIds(new Set());
                      setActiveHighlightType(null);
                    }}
                    className="mt-2 w-full px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white text-xs flex items-center justify-center"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Ocultar Tudo
                  </button>
                )}
              </div>
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}

export { CurriculumDiagram };

