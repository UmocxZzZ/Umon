import * as THREE from 'three'

export interface ThemeColors {
  uBaseColor1: THREE.Color
  uBaseColor2: THREE.Color
  uCoolCore: THREE.Color
  uCoolEdge: THREE.Color
  uWarmCore: THREE.Color
  uWarmEdge: THREE.Color
  uRippleColor: THREE.Color
  uGlowIntensity: number
}

// Umon 品牌色主题 (蓝→青渐变)
export const themes: Record<string, ThemeColors> = {
  umon: {
    uBaseColor1: new THREE.Color(0.01, 0.02, 0.04),
    uBaseColor2: new THREE.Color(0.03, 0.05, 0.09),
    uCoolCore: new THREE.Color(0.0, 0.5, 1.0),    // #0080FF
    uCoolEdge: new THREE.Color(0.0, 0.78, 1.0),    // #00C8FF
    uWarmCore: new THREE.Color(0.2, 0.6, 1.0),
    uWarmEdge: new THREE.Color(0.0, 0.85, 1.0),
    uRippleColor: new THREE.Color(0.0, 0.85, 1.0), // #00D9FF
    uGlowIntensity: 1.2,
  },
  nocturnal: {
    uBaseColor1: new THREE.Color(0.01, 0.02, 0.04),
    uBaseColor2: new THREE.Color(0.03, 0.05, 0.09),
    uCoolCore: new THREE.Color(0.0, 0.3, 1.0),
    uCoolEdge: new THREE.Color(0.6, 0.2, 1.0),
    uWarmCore: new THREE.Color(1.0, 0.2, 0.1),
    uWarmEdge: new THREE.Color(1.0, 0.6, 0.0),
    uRippleColor: new THREE.Color(0.2, 0.9, 1.0),
    uGlowIntensity: 1.0,
  },
}
