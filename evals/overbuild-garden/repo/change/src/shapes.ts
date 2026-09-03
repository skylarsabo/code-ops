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

export interface Named {
  name(): string;
}

export class NamedCircle extends Circle implements Named {
  name() { return 'circle'; }
}

export class NamedSquare extends Square implements Named {
  name() { return 'square'; }
}
