import type { Transition, Variants } from "framer-motion";

/** Springs with deliberate overshoot: this is where the "bounce" in the UI comes from. */
export const bounce: Transition = { type: "spring", stiffness: 520, damping: 15, mass: 0.7 };
export const pop: Transition = { type: "spring", stiffness: 380, damping: 20 };
export const soft: Transition = { type: "spring", stiffness: 240, damping: 26 };

export const stagger = (step = 0.055, delay = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: step, delayChildren: delay } },
});

export const riseIn: Variants = {
  hidden: { opacity: 0, y: 18, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 340, damping: 19 } },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.25 } },
};
