import { describe, it, expect } from 'vitest';
import { Vector3, Matrix4, Quaternion, DEG_TO_RAD, clamp, lerp } from '@core/math';

describe('Vector3', () => {
  it('should create a vector with default values', () => {
    const v = new Vector3();
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
    expect(v.z).toBe(0);
  });

  it('should add vectors correctly', () => {
    const v1 = new Vector3(1, 2, 3);
    const v2 = new Vector3(4, 5, 6);
    v1.add(v2);
    expect(v1.x).toBe(5);
    expect(v1.y).toBe(7);
    expect(v1.z).toBe(9);
  });

  it('should calculate dot product', () => {
    const v1 = new Vector3(1, 2, 3);
    const v2 = new Vector3(4, 5, 6);
    expect(v1.dot(v2)).toBe(32);
  });

  it('should calculate cross product', () => {
    const v1 = new Vector3(1, 0, 0);
    const v2 = new Vector3(0, 1, 0);
    v1.cross(v2);
    expect(v1.x).toBe(0);
    expect(v1.y).toBe(0);
    expect(v1.z).toBe(1);
  });

  it('should normalize correctly', () => {
    const v = new Vector3(3, 4, 0);
    v.normalize();
    expect(v.length()).toBeCloseTo(1, 5);
  });

  it('should calculate distance between vectors', () => {
    const v1 = new Vector3(0, 0, 0);
    const v2 = new Vector3(3, 4, 0);
    expect(v1.distanceTo(v2)).toBe(5);
  });
});

describe('Quaternion', () => {
  it('should create identity quaternion', () => {
    const q = new Quaternion();
    expect(q.x).toBe(0);
    expect(q.y).toBe(0);
    expect(q.z).toBe(0);
    expect(q.w).toBe(1);
  });

  it('should create from axis angle', () => {
    const q = new Quaternion();
    q.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    expect(q.y).toBeCloseTo(Math.sin(Math.PI / 4), 5);
    expect(q.w).toBeCloseTo(Math.cos(Math.PI / 4), 5);
  });

  it('should multiply quaternions', () => {
    const q1 = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
    const q2 = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    q1.multiply(q2);
    expect(q1.length()).toBeCloseTo(1, 5);
  });

  it('should normalize correctly', () => {
    const q = new Quaternion(1, 2, 3, 4);
    q.normalize();
    expect(q.length()).toBeCloseTo(1, 5);
  });

  it('should perform slerp interpolation', () => {
    const q1 = new Quaternion();
    const q2 = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
    q1.slerp(q2, 0.5);
    expect(q1.y).toBeCloseTo(Math.sin(Math.PI / 4), 5);
    expect(q1.w).toBeCloseTo(Math.cos(Math.PI / 4), 5);
  });
});

describe('Matrix4', () => {
  it('should create identity matrix', () => {
    const m = new Matrix4();
    expect(m.elements[0]).toBe(1);
    expect(m.elements[5]).toBe(1);
    expect(m.elements[10]).toBe(1);
    expect(m.elements[15]).toBe(1);
  });

  it('should multiply matrices', () => {
    const m1 = new Matrix4().set(
      2, 0, 0, 0,
      0, 2, 0, 0,
      0, 0, 2, 0,
      0, 0, 0, 1
    );
    const m2 = new Matrix4().set(
      1, 0, 0, 5,
      0, 1, 0, 5,
      0, 0, 1, 5,
      0, 0, 0, 1
    );
    m1.multiply(m2);
    expect(m1.elements[12]).toBe(10);
    expect(m1.elements[13]).toBe(10);
    expect(m1.elements[14]).toBe(10);
  });

  it('should calculate determinant', () => {
    const m = new Matrix4().set(
      1, 0, 0, 0,
      0, 2, 0, 0,
      0, 0, 3, 0,
      0, 0, 0, 1
    );
    expect(m.determinant()).toBe(6);
  });

  it('should invert matrix', () => {
    const m = new Matrix4().set(
      2, 0, 0, 0,
      0, 2, 0, 0,
      0, 0, 2, 0,
      0, 0, 0, 1
    );
    m.invert();
    expect(m.elements[0]).toBe(0.5);
    expect(m.elements[5]).toBe(0.5);
    expect(m.elements[10]).toBe(0.5);
  });

  it('should compose from position, rotation, scale', () => {
    const position = new Vector3(10, 20, 30);
    const quaternion = new Quaternion();
    const scale = new Vector3(2, 2, 2);
    const m = new Matrix4().compose(position, quaternion, scale);
    expect(m.elements[12]).toBe(10);
    expect(m.elements[13]).toBe(20);
    expect(m.elements[14]).toBe(30);
    expect(m.elements[0]).toBe(2);
  });
});

describe('Math utilities', () => {
  it('should convert degrees to radians', () => {
    expect(90 * DEG_TO_RAD).toBeCloseTo(Math.PI / 2, 5);
    expect(180 * DEG_TO_RAD).toBeCloseTo(Math.PI, 5);
  });

  it('should clamp values', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('should lerp values', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
    expect(lerp(-10, 10, 0.5)).toBe(0);
  });
});