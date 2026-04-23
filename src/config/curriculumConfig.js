// src/config/curriculumConfig.js

export const LEVEL_CONFIG = {
    '손오공': [5, 6],
    '샤오': [3, 4, 5],
    '삼장': [2, 3, 4],
    '옥동자': [1, 2, 3]
  };
  
  /**
   * 학생의 레벨(캐릭터명)을 입력받아 해당 레벨이 학습해야 할 단계(Stages) 배열을 반환합니다.
   * @param {string} level - 학생의 진단 레벨 (예: '손오공')
   * @returns {number[]} - 학습해야 할 단계 배열 (예: [5, 6])
   */
  export const getStagesByLevel = (level) => {
    return LEVEL_CONFIG[level] || [1, 2, 3]; // 레벨 정보가 없으면 기본값(옥동자) 반환
  };