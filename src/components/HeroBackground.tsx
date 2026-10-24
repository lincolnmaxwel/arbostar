'use client';

import { useEffect, useRef } from 'react';
import './heroBackground.css';

// Animated hero backdrop (floating invoice / chart / clock cards, shining lines,
// travelling nodes). Pure decoration: static trusted SVG markup, animated by
// CSS + SMIL, paused while off screen, in a hidden tab or with reduced motion.
const MARKUP = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
    <defs>
      <filter id="hb-blur60" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="60"/></filter>
      <filter id="hb-blur40" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="40"/></filter>
      <filter id="hb-blur8"  x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="8"/></filter>
      <linearGradient id="hb-gLeft" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#8db9f5" stop-opacity=".85"/>
        <stop offset="1" stop-color="#bcd6fa" stop-opacity=".55"/>
      </linearGradient>
      <radialGradient id="hb-gDisc" cx=".55" cy=".5" r=".5">
        <stop offset="0"  stop-color="#9fd0fb"/>
        <stop offset=".8" stop-color="#c6e4fd" stop-opacity=".8"/>
        <stop offset="1"  stop-color="#dcefff" stop-opacity=".5"/>
      </radialGradient>
      <pattern id="hb-dots" width="18" height="18" patternUnits="userSpaceOnUse">
        <circle cx="3" cy="3" r="1.6" fill="#3d8ff0"/>
      </pattern>
      <radialGradient id="hb-fadeTL" cx="0" cy="0" r="1">
        <stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/>
      </radialGradient>
      <radialGradient id="hb-fadeBR" cx=".75" cy="1" r=".9">
        <stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/>
      </radialGradient>
      <mask id="hb-mTL"><rect x="0" y="0" width="240" height="200" fill="url(#hb-fadeTL)"/></mask>
      <mask id="hb-mBR"><rect x="1630" y="590" width="432" height="173" fill="url(#hb-fadeBR)"/></mask>
      <linearGradient id="hb-glass" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffffff" stop-opacity=".88"/>
        <stop offset="1" stop-color="#eaf3ff" stop-opacity=".55"/>
      </linearGradient>
      <linearGradient id="hb-glassSoft" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffffff" stop-opacity=".5"/>
        <stop offset="1" stop-color="#e3eefe" stop-opacity=".25"/>
      </linearGradient>
      <linearGradient id="hb-badge" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#4fa3f7"/><stop offset="1" stop-color="#2a7ee6"/>
      </linearGradient>
      <linearGradient id="hb-barCyan" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2fd2f6"/><stop offset="1" stop-color="#7fe3fa" stop-opacity=".7"/>
      </linearGradient>
      <linearGradient id="hb-barBlue" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2386f0"/><stop offset="1" stop-color="#5aaaf5"/>
      </linearGradient>
      <linearGradient id="hb-sweepGrad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#fff" stop-opacity="0"/>
        <stop offset=".5" stop-color="#fff" stop-opacity=".7"/>
        <stop offset="1" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="hb-gA" gradientUnits="userSpaceOnUse" x1="330" y1="262" x2="730" y2="530">
        <stop offset="0" stop-color="#3a9af0" stop-opacity=".9"/><stop offset="1" stop-color="#3a9af0" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="hb-gB" gradientUnits="userSpaceOnUse" x1="-20" y1="466" x2="545" y2="775">
        <stop offset="0" stop-color="#3a9af0" stop-opacity=".55"/><stop offset=".5" stop-color="#3a9af0" stop-opacity=".9"/>
        <stop offset="1" stop-color="#2f8fef" stop-opacity="1"/>
      </linearGradient>
      <linearGradient id="hb-gC" gradientUnits="userSpaceOnUse" x1="1200" y1="268" x2="2030" y2="-10">
        <stop offset="0" stop-color="#3a9af0" stop-opacity="0"/><stop offset=".35" stop-color="#3a9af0" stop-opacity=".5"/>
        <stop offset="1" stop-color="#3a9af0" stop-opacity=".95"/>
      </linearGradient>
      <linearGradient id="hb-gD" gradientUnits="userSpaceOnUse" x1="1031" y1="740" x2="2080" y2="392">
        <stop offset="0" stop-color="#3a9af0" stop-opacity="0"/><stop offset=".4" stop-color="#3a9af0" stop-opacity=".6"/>
        <stop offset=".7" stop-color="#3a9af0" stop-opacity=".9"/><stop offset="1" stop-color="#3a9af0" stop-opacity=".5"/>
      </linearGradient>
      <filter id="hb-cardShadow" x="-30%" y="-30%" width="160%" height="175%">
        <feDropShadow dx="0" dy="18" stdDeviation="20" flood-color="#3b82f6" flood-opacity=".18"/>
      </filter>
      <filter id="hb-nodeGlow" x="-100%" y="-100%" width="300%" height="300%">
        <feDropShadow dx="0" dy="0" stdDeviation="5" flood-color="#2f8fef" flood-opacity=".5"/>
      </filter>
      <filter id="hb-shineBlur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter>
      <clipPath id="hb-clipInv"><rect width="330" height="420" rx="22"/></clipPath>
      <clipPath id="hb-clipChart"><rect width="240" height="165" rx="20"/></clipPath>
      <clipPath id="hb-clipClock"><rect width="260" height="230" rx="20"/></clipPath>
    </defs>
  </svg>
  <svg class="hb-bg" viewBox="0 0 2062 763" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect x="-2000" y="-2000" width="6062" height="4763" fill="#fbfdff"/>
    <ellipse cx="1480" cy="40" rx="560" ry="280" fill="#c9f0fd" opacity=".75" filter="url(#hb-blur60)"/>
    <ellipse cx="1030" cy="390" rx="620" ry="380" fill="#fff" opacity=".85" filter="url(#hb-blur60)"/>
  </svg>
  <svg class="hb-side hb-side--left" viewBox="0 0 1031 763" preserveAspectRatio="xMinYMid meet" aria-hidden="true">
    <defs>
      <path id="hb-pB" d="M -20 466 C 120 480 200 520 272 565 C 360 620 460 700 545 775 C 620 840 700 950 780 1150"/>
    </defs>
    <path d="M -600 -500 L 230 -500 C 330 140 320 430 150 1300 L -600 1300 Z" fill="url(#hb-gLeft)" filter="url(#hb-blur8)"/>
    <ellipse cx="90" cy="870" rx="470" ry="330" fill="#8fb7f3" opacity=".55" filter="url(#hb-blur8)"/>
    <path d="M 140 -40 C 420 160 560 420 700 820" stroke="#fff" stroke-width="140" fill="none" opacity=".45" filter="url(#hb-blur40)"/>
    <rect x="0" y="0" width="240" height="200" fill="url(#hb-dots)" opacity=".4" mask="url(#hb-mTL)"/>
    <g transform="translate(-30 175) rotate(-8)">
      <g class="hb-float hb-float--e">
        <rect width="250" height="200" rx="22" fill="url(#hb-glassSoft)" stroke="#fff" stroke-opacity=".7" filter="url(#hb-cardShadow)"/>
        <rect x="70" y="50" width="120" height="12" rx="6" fill="#b9d2f8" opacity=".6"/>
      </g>
    </g>
    <g transform="translate(385 455) rotate(-12)">
      <g class="hb-float hb-float--b">
        <rect width="140" height="220" rx="20" fill="url(#hb-glassSoft)" stroke="#fff" stroke-opacity=".5"/>
      </g>
    </g>
    <path d="M 330 262 C 470 300 610 400 730 530" stroke="url(#hb-gA)" stroke-width="1.6" fill="none"/>
    <g class="hb-shine" style="animation-delay:-1s; animation-duration:6.5s">
      <path pathLength="1000" d="M 330 262 C 470 300 610 400 730 530" stroke="#6fd0ff" stroke-width="7" fill="none" stroke-linecap="round" filter="url(#hb-shineBlur)"/>
      <path pathLength="1000" d="M 330 262 C 470 300 610 400 730 530" stroke="#e6f9ff" stroke-width="2" fill="none" stroke-linecap="round"/>
    </g>
    <g transform="translate(10 285) rotate(-12)">
      <g class="hb-float">
        <rect width="330" height="420" rx="22" fill="url(#hb-glass)" stroke="#fff" stroke-width="1.5" filter="url(#hb-cardShadow)"/>
        <rect x="58" y="80" width="64" height="64" rx="14" fill="url(#hb-badge)"/>
        <text x="90" y="126" text-anchor="middle" font-size="40" font-weight="600" fill="#fff" font-family="system-ui, sans-serif">$</text>
        <rect x="140" y="88"  width="85"  height="12" rx="6" fill="#cfe0fb"/>
        <rect x="140" y="110" width="120" height="8"  rx="4" fill="#dde9fc"/>
        <rect x="55" y="185" width="180" height="14" rx="7" fill="#cfe0fb"/>
        <rect x="55" y="230" width="170" height="14" rx="7" fill="#cfe0fb"/>
        <rect x="55" y="275" width="180" height="14" rx="7" fill="#cfe0fb"/>
        <rect x="55" y="320" width="160" height="14" rx="7" fill="#cfe0fb"/>
        <rect x="258" y="178" width="42" height="12" rx="6" fill="#d6e5fc"/>
        <rect x="258" y="223" width="42" height="12" rx="6" fill="#d6e5fc"/>
        <rect x="258" y="268" width="42" height="12" rx="6" fill="#d6e5fc"/>
        <rect x="258" y="313" width="42" height="12" rx="6" fill="#d6e5fc"/>
        <g clip-path="url(#hb-clipInv)">
          <polygon class="hb-sweep" points="-260,-40 -170,-40 -240,470 -330,470" fill="url(#hb-sweepGrad)"/>
        </g>
      </g>
    </g>
    <path d="M -20 466 C 120 480 200 520 272 565 C 360 620 460 700 545 775 C 620 840 700 950 780 1150" stroke="url(#hb-gB)" stroke-width="1.8" fill="none"/>
    <g class="hb-shine" style="animation-delay:-3s; animation-duration:5.5s">
      <path pathLength="1000" d="M -20 466 C 120 480 200 520 272 565 C 360 620 460 700 545 775 C 620 840 700 950 780 1150" stroke="#6fd0ff" stroke-width="7" fill="none" stroke-linecap="round" filter="url(#hb-shineBlur)"/>
      <path pathLength="1000" d="M -20 466 C 120 480 200 520 272 565 C 360 620 460 700 545 775 C 620 840 700 950 780 1150" stroke="#e6f9ff" stroke-width="2" fill="none" stroke-linecap="round"/>
    </g>
    <g>
      <circle r="12" fill="#2f8fef" opacity="0">
        <animate attributeName="r" values="12;28" dur="3.2s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values=".35;0" dur="3.2s" repeatCount="indefinite"/>
      </circle>
      <circle r="12" fill="#fff" filter="url(#hb-nodeGlow)"/>
      <circle r="6.5" fill="#2f95f0"/>
      <animateMotion dur="14s" repeatCount="indefinite" keyPoints="0.2;0.38;0.2" keyTimes="0;0.5;1"
        calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1"><mpath href="#hb-pB"/></animateMotion>
    </g>
  </svg>
  <svg class="hb-side hb-side--right" viewBox="1031 0 1031 763" preserveAspectRatio="xMaxYMid meet" aria-hidden="true">
    <defs>
      <path id="hb-pC" d="M 1200 268 C 1450 300 1700 260 1858 138 C 1930 80 1980 30 2030 -10"/>
      <path id="hb-pD" d="M 1031 740 C 1300 720 1500 540 1680 437 C 1820 365 1950 380 2080 392"/>
    </defs>
    <circle cx="1990" cy="380" r="500" fill="url(#hb-gDisc)" filter="url(#hb-blur8)"/>
    <ellipse cx="1880" cy="800" rx="560" ry="270" fill="#9ccdfa" opacity=".6" filter="url(#hb-blur40)"/>
    <rect x="2062" y="-600" width="800" height="2000" fill="#bfe0fb"/>
    <path d="M 1050 820 C 1300 560 1600 470 2100 420" stroke="#fff" stroke-width="120" fill="none" opacity=".4" filter="url(#hb-blur40)"/>
    <rect x="1630" y="590" width="432" height="173" fill="url(#hb-dots)" opacity=".35" mask="url(#hb-mBR)"/>
    <path d="M 1200 268 C 1450 300 1700 260 1858 138 C 1930 80 1980 30 2030 -10" stroke="url(#hb-gC)" stroke-width="1.6" fill="none"/>
    <g class="hb-shine" style="animation-delay:-4.5s; animation-duration:7s">
      <path pathLength="1000" d="M 1200 268 C 1450 300 1700 260 1858 138 C 1930 80 1980 30 2030 -10" stroke="#6fd0ff" stroke-width="7" fill="none" stroke-linecap="round" filter="url(#hb-shineBlur)"/>
      <path pathLength="1000" d="M 1200 268 C 1450 300 1700 260 1858 138 C 1930 80 1980 30 2030 -10" stroke="#e6f9ff" stroke-width="2" fill="none" stroke-linecap="round"/>
    </g>
    <path d="M 1031 740 C 1300 720 1500 540 1680 437 C 1820 365 1950 380 2080 392" stroke="url(#hb-gD)" stroke-width="1.8" fill="none"/>
    <g class="hb-shine" style="animation-delay:-2s; animation-duration:7.5s">
      <path pathLength="1000" d="M 1031 740 C 1300 720 1500 540 1680 437 C 1820 365 1950 380 2080 392" stroke="#6fd0ff" stroke-width="7" fill="none" stroke-linecap="round" filter="url(#hb-shineBlur)"/>
      <path pathLength="1000" d="M 1031 740 C 1300 720 1500 540 1680 437 C 1820 365 1950 380 2080 392" stroke="#e6f9ff" stroke-width="2" fill="none" stroke-linecap="round"/>
    </g>
    <g transform="translate(1785 232) rotate(-14)">
      <g class="hb-float hb-float--c">
        <rect width="240" height="165" rx="20" fill="url(#hb-glass)" stroke="#fff" stroke-width="1.5" filter="url(#hb-cardShadow)"/>
        <rect class="hb-bar" style="animation-delay:-0.0s" x="35"  y="112" width="20" height="28"  rx="4" fill="#c7dcf7"/>
        <rect class="hb-bar" style="animation-delay:-1.2s" x="73"  y="98"  width="20" height="42"  rx="4" fill="#b4d2f8"/>
        <rect class="hb-bar" style="animation-delay:-2.4s" x="111" y="82"  width="20" height="58"  rx="4" fill="url(#hb-barCyan)"/>
        <rect class="hb-bar" style="animation-delay:-3.6s" x="149" y="60"  width="20" height="80"  rx="4" fill="url(#hb-barCyan)"/>
        <rect class="hb-bar" style="animation-delay:-4.8s" x="187" y="36"  width="20" height="104" rx="4" fill="url(#hb-barBlue)"/>
        <g clip-path="url(#hb-clipChart)">
          <polygon class="hb-sweep" style="animation-delay:-3s" points="-260,-40 -170,-40 -240,220 -330,220" fill="url(#hb-sweepGrad)"/>
        </g>
      </g>
    </g>
    <g>
      <circle r="12" fill="#2f8fef" opacity="0">
        <animate attributeName="r" values="12;28" dur="3.2s" begin="1s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values=".35;0" dur="3.2s" begin="1s" repeatCount="indefinite"/>
      </circle>
      <circle r="12" fill="#fff" filter="url(#hb-nodeGlow)"/>
      <circle r="6.5" fill="#2f95f0"/>
      <animateMotion dur="16s" repeatCount="indefinite" keyPoints="0.86;0.6;0.86" keyTimes="0;0.5;1"
        calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1"><mpath href="#hb-pC"/></animateMotion>
    </g>
    <g transform="translate(1880 392) rotate(11)">
      <g class="hb-float hb-float--d">
        <rect width="260" height="230" rx="20" fill="url(#hb-glass)" stroke="#fff" stroke-width="1.5" filter="url(#hb-cardShadow)"/>
        <circle cx="58" cy="58" r="22" fill="none" stroke="#2f8fea" stroke-width="4"/>
        <line x1="58" y1="58" x2="58" y2="45" stroke="#2f8fea" stroke-width="4" stroke-linecap="round">
          <animateTransform attributeName="transform" type="rotate" from="0 58 58" to="360 58 58" dur="24s" repeatCount="indefinite"/>
        </line>
        <line x1="58" y1="58" x2="67" y2="58" stroke="#2f8fea" stroke-width="4" stroke-linecap="round"/>
        <rect x="110" y="48"  width="140" height="12" rx="6" fill="#cfe0fb"/>
        <rect x="110" y="74"  width="110" height="10" rx="5" fill="#dde9fc"/>
        <rect x="25"  y="120" width="215" height="12" rx="6" fill="#cfe0fb"/>
        <rect x="25"  y="150" width="190" height="12" rx="6" fill="#cfe0fb"/>
        <rect x="25"  y="180" width="165" height="12" rx="6" fill="#dde9fc"/>
        <g clip-path="url(#hb-clipClock)">
          <polygon class="hb-sweep" style="animation-delay:-5.5s" points="-260,-40 -170,-40 -240,280 -330,280" fill="url(#hb-sweepGrad)"/>
        </g>
      </g>
    </g>
    <g>
      <circle r="12" fill="#2f8fef" opacity="0">
        <animate attributeName="r" values="12;28" dur="3.2s" begin="2s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values=".35;0" dur="3.2s" begin="2s" repeatCount="indefinite"/>
      </circle>
      <circle r="12" fill="#fff" filter="url(#hb-nodeGlow)"/>
      <circle r="6.5" fill="#2f95f0"/>
      <animateMotion dur="15s" begin="-5s" repeatCount="indefinite" keyPoints="0.52;0.8;0.52" keyTimes="0;0.5;1"
        calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1"><mpath href="#hb-pD"/></animateMotion>
    </g>
  </svg>
`;

export function HeroBackground() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const svgs = Array.from(root.querySelectorAll('svg'));
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    let visible = true;
    const update = () => {
      const run = visible && !mq.matches && !document.hidden;
      root.classList.toggle('hb-paused', !run);
      svgs.forEach((s) => (run ? s.unpauseAnimations() : s.pauseAnimations()));
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      update();
    });
    io.observe(root);
    mq.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      io.disconnect();
      mq.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  return <div ref={ref} className="hb" aria-hidden="true" dangerouslySetInnerHTML={{ __html: MARKUP }} />;
}
