export interface Shape {
  area(): number;
}

export class Circle implements Shape {
  constructor(private r: number) {}
  area() { return Math.PI * this.r * this.r; }
}

export class Square implements Shape {
  constructor(private s: number) {}
  area() { return this.s * this.s; }
}
