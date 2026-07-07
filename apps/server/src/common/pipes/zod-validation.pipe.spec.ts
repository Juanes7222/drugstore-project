import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  describe('when input is valid', () => {
    it('should return the parsed value for a simple string schema', () => {
      const schema = z.string();
      const pipe = new ZodValidationPipe(schema);
      const result = pipe.transform('hello', { type: 'body' });
      expect(result).toBe('hello');
    });

    it('should return the parsed value for a number schema', () => {
      const schema = z.number();
      const pipe = new ZodValidationPipe(schema);
      const result = pipe.transform(42, { type: 'body' });
      expect(result).toBe(42);
    });

    it('should return the parsed object for a valid object schema', () => {
      const schema = z.object({ name: z.string(), age: z.number() });
      const pipe = new ZodValidationPipe(schema);
      const result = pipe.transform({ name: 'test', age: 30 }, { type: 'body' });
      expect(result).toEqual({ name: 'test', age: 30 });
    });
  });

  describe('when input is invalid', () => {
    it('should throw BadRequestException for missing field', () => {
      const schema = z.object({ email: z.string().email(), password: z.string() });
      const pipe = new ZodValidationPipe(schema);

      expect(() => pipe.transform({ email: 'test@test.com' }, { type: 'body' }))
        .toThrow(BadRequestException);
    });

    it('should throw BadRequestException with structured errors', () => {
      const schema = z.object({ email: z.string().email() });
      const pipe = new ZodValidationPipe(schema);

      try {
        pipe.transform({ email: 'not-an-email' }, { type: 'body' });
        fail('Expected BadRequestException to be thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        const response = (e as BadRequestException).getResponse() as Record<string, unknown>;
        expect(response.message).toBe('Validation failed');
        expect(response.errors).toBeInstanceOf(Array);
      }
    });

    it('should throw BadRequestException for null value', () => {
      const schema = z.string();
      const pipe = new ZodValidationPipe(schema);

      expect(() => pipe.transform(null, { type: 'body' }))
        .toThrow(BadRequestException);
    });

    it('should throw BadRequestException for wrong type', () => {
      const schema = z.string();
      const pipe = new ZodValidationPipe(schema);

      expect(() => pipe.transform(123, { type: 'body' }))
        .toThrow(BadRequestException);
    });

    it('should include field paths in error details', () => {
      const schema = z.object({
        user: z.object({ email: z.string().email() }),
      });
      const pipe = new ZodValidationPipe(schema);

      try {
        pipe.transform({ user: { email: 'bad' } }, { type: 'body' });
        fail('Expected BadRequestException');
      } catch (e) {
        const response = (e as BadRequestException).getResponse() as { errors?: Array<{ field: string; message: string }> };
        expect(response.errors).toBeDefined();
        expect(response.errors![0].field).toBe('user.email');
      }
    });

    it('should throw BadRequestException for empty object when fields required', () => {
      const schema = z.object({ name: z.string().min(1) });
      const pipe = new ZodValidationPipe(schema);

      expect(() => pipe.transform({}, { type: 'body' }))
        .toThrow(BadRequestException);
    });
  });

  describe('when Zod transformation is applied', () => {
    it('should return transformed value after successful parse', () => {
      const schema = z.string().transform((s) => parseInt(s, 10));
      const pipe = new ZodValidationPipe(schema);

      const result = pipe.transform('123', { type: 'body' });
      expect(result).toBe(123);
    });

    it('should apply default values from schema', () => {
      const schema = z.object({
        name: z.string(),
        role: z.enum(['ADMIN', 'USER']).default('USER'),
      });
      const pipe = new ZodValidationPipe(schema);

      const result = pipe.transform({ name: 'test' }, { type: 'body' });
      expect(result).toEqual({ name: 'test', role: 'USER' });
    });
  });
});
