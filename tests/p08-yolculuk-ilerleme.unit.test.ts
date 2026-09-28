/**
 * P-08 — `summarizeProgress` (saf, DB'siz): kayıtlı aşama id'lerinden "kaçıncı aşama +
 * sıradaki" türetimi. Yönetici aşamaları sıralayabildiği/gizleyebildiği için kayıt id
 * tabanlıdır; bugün görünmeyen aşamanın eski kaydı sayılmaz.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/db.js', () => ({ prisma: {} }));

const { summarizeProgress } = await import('../src/services/learningJourney.service.js');

const stages = [
  { id: 's1', title: 'Tanışma' },
  { id: 's2', title: 'İlk görüşme' },
  { id: 's3', title: 'Hedef koyma' },
];

describe('P-08 summarizeProgress', () => {
  it('hiç kayıt yoksa 0 geçilmiş, sıradaki ilk aşama', () => {
    expect(summarizeProgress(stages, [])).toEqual({
      completedStageIds: [],
      completedStages: 0,
      nextStage: { id: 's1', title: 'Tanışma', index: 0 },
    });
  });

  it('geçilen aşamalar sayılır, sıradaki ilk geçilmemiş aşamadır', () => {
    const p = summarizeProgress(stages, ['s1', 's2']);
    expect(p.completedStages).toBe(2);
    expect(p.nextStage).toEqual({ id: 's3', title: 'Hedef koyma', index: 2 });
  });

  it('atlanmış aşama varsa sıradaki o olur (kayıt sırası değil aşama sırası)', () => {
    const p = summarizeProgress(stages, ['s3', 's1']);
    expect(p.completedStageIds).toEqual(['s1', 's3']);
    expect(p.nextStage).toEqual({ id: 's2', title: 'İlk görüşme', index: 1 });
  });

  it('bugün görünmeyen (silinmiş/gizlenmiş) aşamanın kaydı sayılmaz', () => {
    const p = summarizeProgress(stages, ['eski', 's1']);
    expect(p.completedStages).toBe(1);
    expect(p.completedStageIds).toEqual(['s1']);
  });

  it('hepsi geçildiyse sıradaki yok', () => {
    const p = summarizeProgress(stages, ['s1', 's2', 's3']);
    expect(p.completedStages).toBe(3);
    expect(p.nextStage).toBeNull();
  });
});
