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
      studentProgress,
      curriculumId,
      courseCode,
      maxWorkload,
      semester,
      avoidDays = [],
      preferredTimes = []
    } = body;
    
    if (!studentProgress || !curriculumId || !courseCode || !maxWorkload || !semester) {
      return NextResponse.json(
        { error: 'Parâmetros incompletos' },
        { status: 400 }
      );
    }
    
    const completedCourses = [
      ...studentProgress.cursadas.map(course => course.codigo),
      ...studentProgress.dispensadas.map(course => course.codigo),
      ...studentProgress.andamento.map(course => course.codigo)
    ];
    const inProgressCourses = studentProgress.andamento.map(course => course.codigo);

    try {
      const availableCourses = await getAvailableCourses(
        session, 
        curriculumId, 
        courseCode,
        completedCourses, 
        inProgressCourses
      );
      
      const availableClasses = await getAvailableClasses(
        session,
        availableCourses,
        semester
      );
      
      const coursesWithUnlockScore = await calculateUnlockScores(
        session,
        availableCourses,
        curriculumId
      );
      
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

  const unlockScoresMap = result.records.reduce((map, record) => {
    map[record.get('courseId')] = record.get('unlockScore');
    return map;
  }, {});

  return availableCourses.map(course => ({
    ...course,
    unlockScore: Number(unlockScoresMap[course.courseId] || 0),
  }));
}

function optimizeSchedule(availableClasses, coursesWithUnlockScore, maxWorkload, avoidDays = [], preferredTimes = []) {
  const unlockScoreMap = coursesWithUnlockScore.reduce((map, course) => {
    map[course.courseId] = course.unlockScore;
    return map;
  }, {});

  const classesByCoursesMap = availableClasses.reduce((map, cls) => {
    if (!map[cls.courseId]) {
      map[cls.courseId] = [];
    }
    map[cls.courseId].push(cls);
    return map;
  }, {});

  Object.keys(classesByCoursesMap).forEach(courseId => {
    const classes = classesByCoursesMap[courseId];
    classes.forEach(cls => {
      let compatibilityScore = 0;
      const hasDaysToAvoid = cls.timeSlots.some(slot => avoidDays.includes(slot));
      if (hasDaysToAvoid) compatibilityScore -= 10;
      if (preferredTimes.includes(cls.phase)) compatibilityScore -= 5;
      
      const unlockScore = Number(unlockScoreMap[courseId]);
      cls.value = unlockScore * 3 + compatibilityScore;
      cls.weeklyHours = Number(cls.weeklyHours);
    });
  });

  const courseIds = Object.keys(classesByCoursesMap);

  const hasTimeConflict = (class1, class2) => {
    const commonSlots = class1.timeSlots.filter(slot => class2.timeSlots.includes(slot));
    return commonSlots.length > 0;
  };

  const conflictsWithSchedule = (newClass, schedule) => {
    return schedule.some(selectedCls => hasTimeConflict(newClass, selectedCls));
  };


  let bestSchedule = [];
  let bestValue = -Infinity;

  /**
   * Função recursiva que explora todas as combinações.
   * @param {number} courseIndex - O índice da *disciplina* que estamos decidindo.
   * @param {Array} currentSchedule - A grade sendo construída nesta ramificação.
   * @param {number} currentWorkload - A carga horária atual desta ramificação.
   */
  function findCombinations(courseIndex, currentSchedule, currentWorkload) {
    
    if (courseIndex === courseIds.length) {
      const currentValue = currentSchedule.reduce((sum, cls) => sum + cls.value, 0);

      if (currentValue > bestValue) {
        bestValue = currentValue;
        bestSchedule = [...currentSchedule];
      }
      return;
    }

    const courseId = courseIds[courseIndex];
    const classesForThisCourse = classesByCoursesMap[courseId];

    findCombinations(courseIndex + 1, currentSchedule, currentWorkload);

    for (const cls of classesForThisCourse) {
      
      const fitsWorkload = (currentWorkload + cls.weeklyHours) <= Number(maxWorkload);
      
      const hasConflict = conflictsWithSchedule(cls, currentSchedule);

      if (fitsWorkload && !hasConflict) {
        currentSchedule.push(cls);
        findCombinations(
          courseIndex + 1, 
          currentSchedule, 
          currentWorkload + cls.weeklyHours
        );
        currentSchedule.pop();
      }
    }
  }
  findCombinations(0, [], 0);

  const finalWorkload = bestSchedule.reduce((sum, cls) => sum + cls.weeklyHours, 0);

  return {
    classes: bestSchedule.map(cls => ({
      ...cls,
      unlockScore: unlockScoreMap[cls.courseId],
    })),
    totalWeeklyHours: finalWorkload,
    remainingHours: Number(maxWorkload) - finalWorkload,
    totalCourses: bestSchedule.length,
    totalValue: bestValue
  };
}