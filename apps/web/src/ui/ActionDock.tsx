import { useEffect } from 'react';

/**
 * Los botones flotantes ("Hablar" y "+") se esconden al bajar por la página y vuelven al subir o al llegar al
 * final, para que nunca tapen botones mientras lees. En computadora viven al pie del menú lateral y no se esconden.
 * Solo cambia una clase en <body> (`fab-away`); el estilo está en styles.css.
 */
export function ActionDock() {
  useEffect(() => {
    let last = window.scrollY;
    let ticking = false;
    const update = () => {
      ticking = false;
      const y = window.scrollY;
      const nearBottom = window.innerHeight + y >= document.documentElement.scrollHeight - 24;
      const goingDown = y > last + 4;
      const goingUp = y < last - 4;
      if (y < 80 || nearBottom || goingUp) document.body.classList.remove('fab-away');
      else if (goingDown) document.body.classList.add('fab-away');
      last = y;
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.body.classList.remove('fab-away');
    };
  }, []);
  return null;
}
