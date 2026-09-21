/**
 * F-27 — inbox sayfalama parametre ayrıştırma (saf, DB gerektirmez).
 *
 * Sınırsız N+1'i sınırlamak için limit/offset; güvenli varsayılan + tavan.
 */

import { describe, it, expect } from 'vitest';
import {
  parseConversationPagination,
  CONVERSATION_PAGE_DEFAULT,
  CONVERSATION_PAGE_MAX,
} from '../src/controllers/conversationController.js';

describe('parseConversationPagination (F-27)', () => {
  it('parametre yoksa varsayılan limit, offset 0', () => {
    expect(parseConversationPagination(undefined, undefined)).toEqual({ limit: CONVERSATION_PAGE_DEFAULT, offset: 0 });
  });

  it('geçerli limit/offset kullanılır', () => {
    expect(parseConversationPagination('10', '5')).toEqual({ limit: 10, offset: 5 });
  });

  it('limit tavanı aşarsa kırpılır', () => {
    expect(parseConversationPagination('9999', '0').limit).toBe(CONVERSATION_PAGE_MAX);
  });

  it('limit 1 altına düşmez', () => {
    expect(parseConversationPagination('0', '0').limit).toBe(1);
    expect(parseConversationPagination('-5', '0').limit).toBe(1);
  });

  it('negatif/geçersiz offset 0 olur', () => {
    expect(parseConversationPagination('30', '-3').offset).toBe(0);
    expect(parseConversationPagination('30', 'abc').offset).toBe(0);
  });
});
