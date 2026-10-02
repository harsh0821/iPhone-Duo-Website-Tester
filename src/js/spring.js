// Apple-style spring (SwiftUI's response / dampingFraction model) baked into a
// CSS linear() easing, so the Web Animations API can play it natively.
const supportsLinear = typeof CSS !== 'undefined' && CSS.supports('animation-timing-function', 'linear(0, 1)');

export function spring({ response = 0.6, damping = 0.88 } = {}) {
  const w0 = (2 * Math.PI) / response;
  const zeta = Math.min(damping, 0.999);
  const wd = w0 * Math.sqrt(1 - zeta * zeta);
  const at = (t) => 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));

  // Settle when we stay within 0.1% of the target.
  let settle = 0;
  for (let t = 0; t < 4; t += 1 / 240) {
    if (Math.abs(1 - at(t)) > 0.001) settle = t;
  }
  const duration = Math.round((settle + 1 / 60) * 1000);

  if (!supportsLinear) return { duration, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' };

  const steps = 48;
  const points = [];
  for (let i = 0; i <= steps; i++) points.push(+at((duration / 1000) * (i / steps)).toFixed(4));
  points[steps] = 1;
  return { duration, easing: `linear(${points.join(', ')})` };
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
