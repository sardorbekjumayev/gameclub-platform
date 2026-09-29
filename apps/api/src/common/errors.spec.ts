import { AppException } from './errors';

describe('AppException', () => {
  it('maps code to documented HTTP status', () => {
    expect(new AppException('BOOKING_SLOT_TAKEN').getStatus()).toBe(409);
    expect(new AppException('VALIDATION_ERROR').getStatus()).toBe(422);
  });
});
