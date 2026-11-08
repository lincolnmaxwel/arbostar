import { HeroBackground } from '@/components/HeroBackground';
import styles from './AuthBackground.module.css';

// Animated backdrop for the sign-in / sign-up / password pages: the same
// floating cards and shining lines as the landing hero, pinned behind the card.
export function AuthBackground() {
  return (
    <div className={styles.bg} aria-hidden="true">
      <HeroBackground />
    </div>
  );
}
