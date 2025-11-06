import { NextResponse } from 'next/server';
import neo4j from 'neo4j-driver';

let driver;

async function getDriver() {
  if (!driver) {
    try {
      driver = neo4j.driver(
        process.env.NEO4J_URI || 'bolt://localhost:7687',
        neo4j.auth.basic(
          process.env.NEO4J_USER || 'neo4j',
          process.env.NEO4J_PASSWORD || 'Matheus2001'
        )
      );
      await driver.verifyConnectivity();
      console.log('✅ Sugestoes API: Neo4j driver connected');
    } catch (error) {
      console.error('🔴 Sugestoes API: Could not create Neo4j driver.', error);
      driver = null;
    }
  }
  return driver;
}

export async function POST(request) {
  try {
    const driver = await getDriver();
    
    if (!driver) {
      return NextResponse.json(
        { error: 'Database connection not available.' },
        { status: 500 }
      );
    }
    
    const session = driver.session();
    const body = await request.json();
        
    const {
      studentProgress, // Progresso atual do aluno (disciplinas cursadas, em andamento)
      curriculumId,    // ID do currículo do aluno
      courseCode,      // Código do curso
      maxWorkload,     // Carga horária máxima semanal (em horas)
      semester,        // Semestre para o qual deseja sugestões (ex: "2023.1")
      avoidDays = [],  // Dias que o aluno prefere não ter aula (opcional)
      preferredTimes = [] // Horários preferidos (manhã/tarde/noite) (opcional)
    } = body;
    
    // Verificar se os parâmetros obrigatórios estão presentes
    if (!studentProgress || !curriculumId || !courseCode || !maxWorkload || !semester) {
      return NextResponse.json(
        { error: 'Parâmetros incompletos' },
        { status: 400 }
      );
    }
    
    // Extrair disciplinas já cursadas e em andamento
    const completedCourses = [
      ...studentProgress.cursadas.map(course => course.codigo),
      ...studentProgress.dispensadas.map(course => course.codigo),
      ...studentProgress.andamento.map(course => course.codigo) // Adiciona as em andamento também
    ];
    const inProgressCourses = studentProgress.andamento.map(course => course.codigo);

    // console.log('Cursadas:', completedCourses);
    // console.log('Em andamento:', inProgressCourses);
    
    try {
      // 1. Buscar disciplinas disponíveis
      const availableCourses = await getAvailableCourses(
        session, 
        curriculumId, 
        courseCode,
        completedCourses, 
        inProgressCourses
      );
      // console.log(`📌 Disciplinas disponíveis: ${availableCourses.map(course => course.courseName).join(', ')}`);
      
      // 2. Buscar turmas disponíveis
      const availableClasses = await getAvailableClasses(
        session,
        availableCourses,
        semester
      );
      // console.log(`📌 Turmas disponíveis: ${availableClasses.length}`);
      
      // 3. Calcular unlock scores
      const coursesWithUnlockScore = await calculateUnlockScores(
        session,
        availableCourses,
        curriculumId
      );
      
      // 4. Otimizar
      const suggestedSchedule = optimizeSchedule(
        availableClasses,
        coursesWithUnlockScore,
        maxWorkload,
        avoidDays,
        preferredTimes
      );


      return NextResponse.json({ 
        suggestedSchedule,
        availableCourses: coursesWithUnlockScore
      });
      
    } catch (error) {
      console.error('Error in suggestion processing:', error);
      return NextResponse.json(
        { error: 'Erro ao processar sugestões: ' + error.message },
        { status: 500 }
      );
    } finally {
      await session.close();
    }
    
  } catch (error) {
    console.error('Error generating suggestions:', error);
    return NextResponse.json(
      { error: 'Falha ao gerar sugestões de matrícula' },
      { status: 500 }
    );
  }
}

// Funções auxiliares abaixo
async function getAvailableCourses(session, curriculumId, courseCode, completedCourses, inProgressCourses) {
  const query = `
    // 1. Encontra o currículo base usando os parâmetros
    MATCH (cur:Curriculum {id: $curriculumId, courseCode: $courseCode})

    // 2. Encontra todas as disciplinas que fazem parte deste currículo
    MATCH (c1:Course)-[:PART_OF]->(cur)
    MATCH (c2:Course)-[:PART_OF]->(cur)

    // 3. Encontra as relações de pré-requisito específicas do currículo,
    //    excluindo disciplinas que o aluno já cursou.
    MATCH (c1)-[r {curriculumId: cur.id, courseCode: cur.courseCode}]->(c2)
    WHERE c1.etiqueta = TRUE
      AND c2.etiqueta = TRUE
      AND NOT c1.courseId IN $completedCourses
      AND NOT c2.courseId IN $completedCourses

    // 4. Cria uma lista única de disciplinas candidatas que ainda não foram cursadas
    WITH COLLECT(DISTINCT c1) + COLLECT(DISTINCT c2) AS allCoursesList
    UNWIND allCoursesList AS course
    WITH DISTINCT course

    // 5. CLÁUSULA ADICIONADA: Para cada disciplina candidata, verifica se TODOS os seus pré-requisitos foram satisfeitos.
    OPTIONAL MATCH (course)<-[:IS_PREREQUISITE_FOR]-(prereq:Course)
    WITH course, collect(prereq.courseId) AS prerequisites
    // Usa a lista de matérias concluídas ($completedCourses) para filtrar os pré-requisitos não atendidos
    WITH course, prerequisites,
        [x IN prerequisites WHERE NOT x IN $completedCourses] AS unmetPrerequisites
    // Apenas continua se a lista de pré-requisitos não atendidos estiver vazia
    WHERE size(unmetPrerequisites) = 0
      AND course.etiqueta = TRUE

    // 6. Retorna as disciplinas que passaram em todos os filtros, prontas para serem cursadas.
    RETURN course.courseId AS courseId,
          course.name AS courseName,
          course.workloadHours AS workloadHours,
          course.suggestedSemester AS suggestedSemester
    ORDER BY course.suggestedSemester
  `;
  
  const result = await session.run(query, {
    curriculumId,
    courseCode,
    completedCourses,
    inProgressCourses
  });
  
  return result.records.map(record => ({
    courseId: record.get('courseId'),
    courseName: record.get('courseName'),
    workloadHours: Number(record.get('workloadHours')),
    suggestedSemester: record.get('suggestedSemester'),
  }));
}

async function getAvailableClasses(session, availableCourses, semester) {
  const courseIds = availableCourses.map(course => course.courseId);

  const query = `
    // Buscar turmas disponíveis para as disciplinas no semestre especificado
    MATCH (course:Course)-[:OFFERS]->(class:Class {periodo: 20252})
    WHERE course.courseId IN $courseIds
    
    RETURN course.courseId AS courseId,
           course.name AS courseName,
           class.codigo_turma AS classCode,
           class.nome_disciplina AS className,
           class.num_aulas_semana AS weeklyHours,
           class.sequenciais_horas_ocupadas AS timeSlots,
           class.fase AS phase,
           class.periodo AS semester,
           class.vagas_ofertadas AS totalSeats,
           class.vagas_ocupadas AS occupiedSeats,
           class.saldo_vagas AS availableSeats
  `;

  const result = await session.run(query, {
    courseIds,
    semester,
  });

  // Mapeia os resultados retornados pela query
  return result.records.map(record => ({
    courseId: record.get('courseId'),
    courseName: record.get('courseName'),
    classCode: record.get('classCode'),
    className: record.get('className'),
    weeklyHours: Number(record.get('weeklyHours')),
    timeSlots: record.get('timeSlots').map(Number),
    phase: Number(record.get('phase')),
    semester: record.get('semester'),
    totalSeats: Number(record.get('totalSeats')),
    occupiedSeats: Number(record.get('occupiedSeats')),
    availableSeats: Number(record.get('availableSeats')),
  }));
}

async function calculateUnlockScores(session, availableCourses, curriculumId) {
  const courseIds = availableCourses.map(course => course.courseId);

  const query = `
    // Para cada disciplina disponível, calcular quantas outras disciplinas ela desbloqueia
    MATCH (curr:Curriculum {id: $curriculumId})<-[:PART_OF]-(course:Course)
    WHERE course.courseId IN $courseIds
    
    // Encontrar disciplinas que têm esta como pré-requisito (primeiro nível)
    OPTIONAL MATCH (course)<-[:IS_PREREQUISITE_FOR]-(direct:Course)
    
    // Encontrar disciplinas que são desbloqueadas indiretamente (segundo nível)
    OPTIONAL MATCH (direct)<-[:IS_PREREQUISITE_FOR]-(indirect:Course)
    
    // Calcular o unlock score com peso maior para disciplinas de desbloqueio direto
    WITH course, 
         collect(DISTINCT direct.courseId) as directUnlocks,
         collect(DISTINCT indirect.courseId) as indirectUnlocks
    
    // Fórmula para o unlock score: cada desbloqueio direto vale 2 pontos, cada indireto vale 1
    WITH course, 
         size(directUnlocks) * 2 + size(indirectUnlocks) as unlockScore
    
    RETURN course.courseId as courseId,
           unlockScore
  `;

  const result = await session.run(query, {
    courseIds,
    curriculumId
  });

  // Mapear os resultados do unlock score
  const unlockScoresMap = result.records.reduce((map, record) => {
    map[record.get('courseId')] = record.get('unlockScore');
    return map;
  }, {});

  // Adicionar o unlock score às disciplinas disponíveis
  return availableCourses.map(course => ({
    ...course,
    unlockScore: Number(unlockScoresMap[course.courseId] || 0), // Converte para número
  }));
}

function optimizeSchedule(availableClasses, coursesWithUnlockScore, maxWorkload, avoidDays = [], periodsToAvoid = []) {
  // Mapa para recuperar facilmente o unlock score de um curso
  const unlockScoreMap = coursesWithUnlockScore.reduce((map, course) => {
    map[course.courseId] = course.unlockScore;
    return map;
  }, {});

  // Pré-processamento para evitar duplicidade de disciplinas
  // Agrupamos as turmas por disciplina
  const classesByCoursesMap = availableClasses.reduce((map, cls) => {
    if (!map[cls.courseId]) {
      map[cls.courseId] = [];
    }
    map[cls.courseId].push(cls);
    return map;
  }, {});

  // Para cada disciplina, classificar suas turmas por preferências
  const classesWithScore = [];

  Object.keys(classesByCoursesMap).forEach(courseId => {
    const classes = classesByCoursesMap[courseId];

    classes.forEach(cls => {
      // Calcular um score de compatibilidade para a turma
      let compatibilityScore = 0;

      // Penalizar turmas em dias que o aluno quer evitar
      const hasDaysToAvoid = cls.timeSlots.some(slot => avoidDays.includes(slot));
      if (hasDaysToAvoid) {
        compatibilityScore -= 10;
      }

      // Penalizar turmas em horários preferidos
      if (periodsToAvoid.includes(cls.phase)) {
        compatibilityScore -= 5;
      }

      // O valor da turma é uma combinação do unlock score da disciplina e compatibilidade
      const unlockScore = Number(unlockScoreMap[courseId]); // Converte para número
      const value = unlockScore * 3 + compatibilityScore;

      classesWithScore.push({
        ...cls,
        value,
        density: value / Number(cls.weeklyHours) // Densidade de valor (valor por hora de aula)
      });
    });
  });

  // Ordenar as turmas pela densidade de valor (decrescente)
  classesWithScore.sort((a, b) => b.density - a.density);

  // Algoritmo guloso para selecionar turmas
  const selectedClasses = [];
  let currentWorkload = 0;
  const selectedCourseIds = new Set(); // Para evitar selecionar mais de uma turma da mesma disciplina

  // Função para verificar conflito de horários
  const hasTimeConflict = (class1, class2) => {
    const commonSlots = class1.timeSlots.filter(slot => class2.timeSlots.includes(slot));
    return commonSlots.length > 0;
  };

  for (const cls of classesWithScore) {
    // Verificar se já selecionamos uma turma desta disciplina
    if (selectedCourseIds.has(cls.courseId)) continue;

    // Verificar se adicionar essa turma excede a carga horária máxima
    if (Number(currentWorkload) + Number(cls.weeklyHours) > Number(maxWorkload)) continue;

    // Verificar conflitos de horário com turmas já selecionadas
    const hasConflict = selectedClasses.some(selectedCls => hasTimeConflict(cls, selectedCls));
    if (hasConflict) continue;

    // Adicionar a turma à seleção
    selectedClasses.push(cls);
    currentWorkload += Number(cls.weeklyHours);
    selectedCourseIds.add(cls.courseId);
  }

  // Enriquecer as turmas selecionadas com informações extras
  return {
    classes: selectedClasses.map(cls => ({
      ...cls,
      unlockScore: unlockScoreMap[cls.courseId],
      phase: cls.phase
    })),
    totalWeeklyHours: currentWorkload,
    remainingHours: Number(maxWorkload) - Number(currentWorkload),
    totalCourses: selectedClasses.length
  };
}