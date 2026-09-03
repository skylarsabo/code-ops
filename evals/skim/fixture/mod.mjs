// Fixture module for the skim eval. Every body line carries ZZBODYTOKEN, so the eval can
// prove the outline printed structure and no body.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const LABEL = 'fixture';

const HIDDEN = 'ZZBODYTOKEN-const';

export function alpha(value) {
  const inner = 'ZZBODYTOKEN-alpha';
  return `${value}${inner}${HIDDEN}${readFileSync}${join}`;
}

async function beta() {
  return 'ZZBODYTOKEN-beta';
}

export class Gamma {
  method() {
    return 'ZZBODYTOKEN-gamma';
  }
}

export { beta };
export default alpha;
