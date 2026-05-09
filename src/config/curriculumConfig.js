// src/config/curriculumConfig.js

export const LEVEL_CONFIG = {
  방정대마법사: [5, 6],
  '방정 대마법사': [5, 6],
  수식현자: [3, 4, 5],
  '수식 현자': [3, 4, 5],
  탐구마법사: [2, 3, 4],
  '탐구 마법사': [2, 3, 4],
  입문마법사: [1, 2, 3],
  '입문 마법사': [1, 2, 3],
  손오공: [5, 6],
  샤오: [3, 4, 5],
  삼장: [2, 3, 4],
  옥동자: [1, 2, 3],
}

/**
 * 학생의 레벨(캐릭터명)을 입력받아 해당 레벨이 학습해야 할 단계(Stages) 배열을 반환합니다.
 * @param {string} level - 학생의 진단 레벨·캐릭터명 (예: '손오공', 레거시 '방정 대마법사')
 * @returns {number[]} - 학습해야 할 단계 배열 (예: [5, 6])
 */
export const getStagesByLevel = (level) => {
  return LEVEL_CONFIG[level] || [1, 2, 3]
}