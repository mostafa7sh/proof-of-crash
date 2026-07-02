import { motion } from 'framer-motion';
import { UserSearch, Send, Users, ShieldCheck, Coins, type LucideIcon } from 'lucide-react';
import { Reveal } from '../motion/Reveal';
import { staggerContainer, fadeUp } from '../motion/variants';

interface FlowStep { icon: LucideIcon; label: string; sub: string }

const FLOW: FlowStep[] = [
  { icon: UserSearch,  label: 'Researcher', sub: 'discovers a crash' },
  { icon: Send,        label: 'Submission', sub: 'crash proof on-chain' },
  { icon: Users,       label: 'Validation', sub: 'verifiers reproduce' },
  { icon: ShieldCheck, label: 'Consensus',  sub: 'median finalizes' },
  { icon: Coins,       label: 'Reward',     sub: 'tokens minted' },
];

/**
 * Progressive vertical workflow rendered with plain DOM + CSS and animated by
 * framer variants (a simple stagger). No SVG paths, no canvas — it stays crisp
 * at any size and costs almost nothing to animate.
 */
export function FlowDiagram() {
  return (
    <section className="section flow-section">
      <div className="section-inner" style={{ maxWidth: 720 }}>
        <Reveal>
          <h2 className="section-title">Platform <span className="gradient-text">Flow</span></h2>
        </Reveal>

        <motion.div
          className="flow"
          variants={staggerContainer(0.16)}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-90px' }}
        >
          {FLOW.map((step) => {
            const Icon = step.icon;
            return (
              <motion.div key={step.label} className="flow-node" variants={fadeUp}>
                <span className="flow-node-badge"><Icon /></span>
                <div className="flow-node-text">
                  <span className="flow-node-label">{step.label}</span>
                  <span className="flow-node-sub">{step.sub}</span>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
