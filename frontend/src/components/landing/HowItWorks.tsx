import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bug, FileCheck2, Users, ShieldCheck, Coins, type LucideIcon } from 'lucide-react';
import { Reveal } from '../motion/Reveal';
import { EASE } from '../motion/variants';

interface Step { icon: LucideIcon; title: string; desc: string }

const STEPS: Step[] = [
  { icon: Bug,         title: 'Find a Bug',          desc: 'A researcher runs a registered target and discovers an input that makes it crash.' },
  { icon: FileCheck2,  title: 'Submit Proof',         desc: 'They submit the crashing input and its content hash as an on-chain crash proof.' },
  { icon: Users,       title: 'Validators Review',    desc: 'Independent verifiers reproduce the crash locally and sign a severity score.' },
  { icon: ShieldCheck, title: 'Consensus Reached',    desc: 'When a quorum agrees within the outlier threshold, the median finalizes the proof.' },
  { icon: Coins,       title: 'Reward Distribution',  desc: 'The engine mints PoC tokens to the finder and the accurate verifiers.' },
];

// Fraction of the viewport height used as the activation line. A step becomes
// active when its vertical centre is nearest this line — slightly above centre
// so the left panel switches as a card rises into the comfortable reading zone.
const TRIGGER = 0.42;

/**
 * Scroll-driven storytelling: a sticky stage on the left mirrors whichever step
 * is currently nearest the trigger line, while the step cards scroll past on the
 * right. Active detection reads each card's position on scroll (rAF-throttled,
 * symmetric on the way up and down) so the left content changes exactly when the
 * corresponding right-side card reaches the trigger point.
 */
export function HowItWorks() {
  const [active, setActive] = useState(0);
  const stepRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const triggerY = window.innerHeight * TRIGGER;
      let best = 0;
      let bestDist = Infinity;
      stepRefs.current.forEach((el, i) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        const center = r.top + r.height / 2;
        const dist = Math.abs(center - triggerY);
        if (dist < bestDist) { bestDist = dist; best = i; }
      });
      setActive((prev) => (prev === best ? prev : best));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const ActiveIcon = STEPS[active]!.icon;

  return (
    <section className="section hiw-section">
      <div className="section-inner">
        <Reveal>
          <h2 className="section-title">How It <span className="gradient-text">Works</span></h2>
        </Reveal>

        <div className="hiw">
          {/* Sticky stage — crossfades to the active step */}
          <div className="hiw-rail">
            <div className="hiw-stage">
              <AnimatePresence mode="wait">
                <motion.div
                  key={active}
                  className="hiw-stage-icon"
                  initial={{ opacity: 0, scale: 0.85, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -10 }}
                  transition={{ duration: 0.35, ease: EASE }}
                >
                  <ActiveIcon strokeWidth={1.5} />
                </motion.div>
              </AnimatePresence>
              <div className="hiw-stage-meta">
                <span className="hiw-stage-step">Step {active + 1} / {STEPS.length}</span>
                <AnimatePresence mode="wait">
                  <motion.h3
                    key={active}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.3, ease: EASE }}
                  >
                    {STEPS[active]!.title}
                  </motion.h3>
                </AnimatePresence>
              </div>
              <ol className="hiw-dots" aria-hidden="true">
                {STEPS.map((s, i) => (
                  <li key={s.title} className={i === active ? 'active' : i < active ? 'done' : ''}>
                    <span className="hiw-dot" />
                  </li>
                ))}
              </ol>
            </div>
          </div>

          {/* Scrolling step cards */}
          <div className="hiw-steps">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              return (
                <div
                  key={s.title}
                  ref={(el) => { stepRefs.current[i] = el; }}
                  className={`hiw-step ${i === active ? 'is-active' : ''}`}
                >
                  <Reveal direction="up" className="hiw-step-inner">
                    <span className="hiw-step-num">{String(i + 1).padStart(2, '0')}</span>
                    <Icon className="hiw-step-icon" />
                    <div>
                      <h3>{s.title}</h3>
                      <p>{s.desc}</p>
                    </div>
                  </Reveal>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
