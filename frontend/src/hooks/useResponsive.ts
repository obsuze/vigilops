import { useState, useEffect } from 'react'
const BREAKPOINTS = { sm: 576, md: 768, lg: 992, xl: 1200 }
export function useResponsive() {
  const [width, setWidth] = useState(window.innerWidth)
  useEffect(() => {
    const handler = () => setWidth(window.innerWidth)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return {
    isMobile: width < BREAKPOINTS.md,
    isTablet: width >= BREAKPOINTS.md && width < BREAKPOINTS.lg,
    isDesktop: width >= BREAKPOINTS.lg,
    width,
    pick: <T>(mobile: T, desktop: T): T => width < BREAKPOINTS.md ? mobile : desktop,
    modalWidth: () => width < BREAKPOINTS.md ? '95vw' : 600,
  }
}
