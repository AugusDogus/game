import { describe, expect, it } from "bun:test";
import {
  vec2,
  vec2Zero,
  vec2Up,
  vec2Down,
  vec2Left,
  vec2Right,
  add,
  sub,
  scale,
  dot,
  magnitude,
  normalize,
  angleBetweenVectors,
  degToRad,
  radToDeg,
  lerp,
  smoothDamp,
} from "./math.js";

describe("Vector operations", () => {
  describe("vec2", () => {
    it("creates a vector", () => {
      const v = vec2(3, 4);
      expect(v.x).toBe(3);
      expect(v.y).toBe(4);
    });
  });

  describe("constants", () => {
    it("defines zero vector", () => {
      expect(vec2Zero.x).toBe(0);
      expect(vec2Zero.y).toBe(0);
    });

    it("defines up vector (Y-up)", () => {
      expect(vec2Up.x).toBe(0);
      expect(vec2Up.y).toBe(1);
    });

    it("defines down vector", () => {
      expect(vec2Down.x).toBe(0);
      expect(vec2Down.y).toBe(-1);
    });

    it("defines left vector", () => {
      expect(vec2Left.x).toBe(-1);
      expect(vec2Left.y).toBe(0);
    });

    it("defines right vector", () => {
      expect(vec2Right.x).toBe(1);
      expect(vec2Right.y).toBe(0);
    });
  });

  describe("add", () => {
    it("adds two vectors", () => {
      const result = add(vec2(1, 2), vec2(3, 4));
      expect(result.x).toBe(4);
      expect(result.y).toBe(6);
    });
  });

  describe("sub", () => {
    it("subtracts two vectors", () => {
      const result = sub(vec2(5, 7), vec2(3, 4));
      expect(result.x).toBe(2);
      expect(result.y).toBe(3);
    });
  });

  describe("scale", () => {
    it("scales a vector", () => {
      const result = scale(vec2(3, 4), 2);
      expect(result.x).toBe(6);
      expect(result.y).toBe(8);
    });

    it("handles negative scale", () => {
      const result = scale(vec2(3, 4), -1);
      expect(result.x).toBe(-3);
      expect(result.y).toBe(-4);
    });
  });

  describe("dot", () => {
    it("calculates dot product", () => {
      expect(dot(vec2(1, 0), vec2(0, 1))).toBe(0); // Perpendicular
      expect(dot(vec2(1, 0), vec2(1, 0))).toBe(1); // Same direction
      expect(dot(vec2(1, 0), vec2(-1, 0))).toBe(-1); // Opposite direction
      expect(dot(vec2(3, 4), vec2(2, 5))).toBe(26); // 3*2 + 4*5 = 26
    });
  });

  describe("magnitude", () => {
    it("calculates magnitude", () => {
      expect(magnitude(vec2(3, 4))).toBe(5); // 3-4-5 triangle
      expect(magnitude(vec2(1, 0))).toBe(1);
      expect(magnitude(vec2(0, 0))).toBe(0);
    });
  });

  describe("normalize", () => {
    it("normalizes a vector", () => {
      const result = normalize(vec2(3, 4));
      expect(result.x).toBeCloseTo(0.6, 10);
      expect(result.y).toBeCloseTo(0.8, 10);
      expect(magnitude(result)).toBeCloseTo(1, 10);
    });

    it("returns zero for zero vector", () => {
      const result = normalize(vec2Zero);
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });
  });
});

describe("Angle calculations", () => {
  describe("angleBetweenVectors", () => {
    it("returns 0 for same direction", () => {
      expect(angleBetweenVectors(vec2Up, vec2Up)).toBeCloseTo(0, 5);
    });

    it("returns 90 for perpendicular vectors", () => {
      expect(angleBetweenVectors(vec2Up, vec2Right)).toBeCloseTo(90, 5);
    });

    it("returns 180 for opposite directions", () => {
      expect(angleBetweenVectors(vec2Up, vec2Down)).toBeCloseTo(180, 5);
    });

    it("works with non-unit vectors", () => {
      expect(angleBetweenVectors(vec2(2, 0), vec2(0, 3))).toBeCloseTo(90, 5);
    });
  });

  describe("degToRad", () => {
    it("converts degrees to radians", () => {
      expect(degToRad(0)).toBe(0);
      expect(degToRad(90)).toBeCloseTo(Math.PI / 2, 10);
      expect(degToRad(180)).toBeCloseTo(Math.PI, 10);
      expect(degToRad(360)).toBeCloseTo(2 * Math.PI, 10);
    });
  });

  describe("radToDeg", () => {
    it("converts radians to degrees", () => {
      expect(radToDeg(0)).toBe(0);
      expect(radToDeg(Math.PI / 2)).toBeCloseTo(90, 10);
      expect(radToDeg(Math.PI)).toBeCloseTo(180, 10);
      expect(radToDeg(2 * Math.PI)).toBeCloseTo(360, 10);
    });
  });
});

describe("Interpolation", () => {
  describe("lerp", () => {
    it("interpolates between two values", () => {
      expect(lerp(0, 10, 0)).toBe(0);
      expect(lerp(0, 10, 1)).toBe(10);
      expect(lerp(0, 10, 0.5)).toBe(5);
      expect(lerp(0, 10, 0.25)).toBe(2.5);
    });

    it("extrapolates beyond [0, 1]", () => {
      expect(lerp(0, 10, 2)).toBe(20);
      expect(lerp(0, 10, -1)).toBe(-10);
    });
  });

  describe("smoothDamp", () => {
    it("moves value toward target", () => {
      const [newValue] = smoothDamp(0, 10, 0, 0.3, 0.016);
      expect(newValue).toBeGreaterThan(0);
      expect(newValue).toBeLessThan(10);
    });

    it("returns target when already at target", () => {
      const [newValue] = smoothDamp(10, 10, 0, 0.3, 0.016);
      expect(newValue).toBeCloseTo(10, 5);
    });

    it("decelerates as approaching target", () => {
      // Start far from target with high velocity
      const [val1, vel1] = smoothDamp(0, 10, 0, 0.3, 0.016);
      const [val2, vel2] = smoothDamp(val1, 10, vel1, 0.3, 0.016);
      const [val3] = smoothDamp(val2, 10, vel2, 0.3, 0.016);
      
      // Should be getting closer
      expect(val1).toBeLessThan(val2);
      expect(val2).toBeLessThan(val3);
      expect(val3).toBeLessThan(10);
    });
  });
});
