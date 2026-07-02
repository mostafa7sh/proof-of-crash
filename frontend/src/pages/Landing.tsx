import { Link } from 'react-router-dom';
import { motion, MotionConfig } from 'framer-motion';
import {
  Upload, Target, ChevronDown, ShieldOff, FileWarning, EyeOff,
  Network, Coins, ScrollText, Users, Lock, KeyRound,
  Rocket, Bug, Blocks, type LucideIcon,
} from 'lucide-react';
import { useProofs } from '../hooks/useData';
import { useAsync } from '../hooks/useAsync';
import { ledgerApi } from '../api';
import { Reveal } from '../components/motion/Reveal';
import { CountUp } from '../components/motion/CountUp';
import { NetworkBackground } from '../components/landing/NetworkBackground';
import { HowItWorks } from '../components/landing/HowItWorks';
import { FlowDiagram } from '../components/landing/FlowDiagram';
import { staggerContainer, fadeUp } from '../components/motion/variants';

// Public marketing page. All figures come from the public ledger/proofs
// endpoints — nothing is fabricated. Animations use framer-motion (transform +
// opacity only) and are neutralised under prefers-reduced-motion via MotionConfig.
export function Landing() {
  const supply = useAsync(() => ledgerApi.supply(), []);
  const allProofs = useProofs({ page: 1, page_size: 1 });
  const finalized = useProofs({ status: 'finalized', page: 1, page_size: 1 });

  return (
    <MotionConfig reducedMotion="user">
      <div>
        <HeroSection />
        <ProblemSection />
        <HowItWorks />
        <FlowDiagram />
        <FeaturesSection />
        <StatsSection
          reports={allProofs.data?.total ?? 0}
          findings={finalized.data?.total ?? 0}
          minted={supply.data?.total_supply ?? 0}
          blocks={supply.data?.tip.height ?? 0}
        />
        <FinalCta />
      </div>
    </MotionConfig>
  );
}

/* ── Section 1 — Hero ──────────────────────────────────────────────────────── */
function HeroSection() {
  return (
    <section className="hero hero-fx">
      <NetworkBackground />
      <motion.div
        className="hero-inner"
        variants={staggerContainer(0.12, 0.05)}
        initial="hidden"
        animate="show"
      >
        <motion.div variants={fadeUp} className="hero-pill">Decentralized Bug Discovery Protocol</motion.div>
        <motion.h1 variants={fadeUp}>
          Proof of <span className="gradient-text">Crash</span>
        </motion.h1>
        <motion.p variants={fadeUp} className="lead">
          A blockchain-backed bug bounty where every crash is reproduced, scored by independent
          validators, and finalized through consensus. Find real bugs, prove them, get rewarded —
          all on an immutable, auditable ledger.
        </motion.p>
        <motion.div variants={fadeUp} className="hero-cta">
          <Link to="/submit" className="btn btn-primary"><Upload /> Submit a Target</Link>
          <Link to="/proofs" className="btn btn-secondary"><Target /> Explore Bug Proofs</Link>
        </motion.div>
      </motion.div>

      <div className="hero-scroll-cue">
        <span>SCROLL</span>
        <ChevronDown />
      </div>
    </section>
  );
}

/* ── Section 2 — The Problem ───────────────────────────────────────────────── */
const PROBLEMS: Array<{ icon: LucideIcon; title: string; desc: string }> = [
  { icon: ShieldOff, title: 'Centralized Gatekeepers', desc: 'A single vendor decides whether a report is valid. Researchers have no recourse and no transparency when a finding is dismissed.' },
  { icon: FileWarning, title: 'Unreproducible Claims', desc: 'Bug reports are prose, not proof. Without a re-runnable artifact, validity becomes a matter of opinion and endless back-and-forth.' },
  { icon: EyeOff, title: 'Opaque, Delayed Rewards', desc: 'Payout criteria and timing are hidden. Contributors rarely know what a finding is worth — or when, or if, they will be paid.' },
];

function ProblemSection() {
  return (
    <section className="section">
      <div className="section-inner">
        <Reveal className="section-head">
          <span className="eyebrow">The Problem</span>
          <h2 className="section-title" style={{ marginBottom: 0 }}>Bug reporting is <span className="gradient-text">broken</span></h2>
          <p className="section-lead">Today's vulnerability disclosure runs on trust in a single party. That breaks down exactly where it matters most.</p>
        </Reveal>

        <motion.div
          className="problem-grid"
          variants={staggerContainer(0.12)}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
        >
          {PROBLEMS.map(({ icon: Icon, title, desc }) => (
            <motion.div key={title} className="card problem-card" variants={fadeUp}>
              <span className="pc-icon"><Icon /></span>
              <h3>{title}</h3>
              <p>{desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

/* ── Section 5 — Features ──────────────────────────────────────────────────── */
const FEATURES: Array<{ icon: LucideIcon; title: string; desc: string }> = [
  { icon: Network, title: 'Decentralized Validation', desc: 'No central authority. Independent verifiers reproduce each crash and vote on its severity.' },
  { icon: Coins, title: 'Transparent Rewards', desc: 'Reward math runs in the open consensus engine — finders and accurate verifiers are paid automatically.' },
  { icon: ScrollText, title: 'Blockchain Audit Trail', desc: 'Every finalized crash becomes an immutable block. Nothing is edited, hidden, or retroactively denied.' },
  { icon: Users, title: 'Community Verification', desc: 'A crash is only valid when a quorum of the community independently reproduces it.' },
  { icon: Lock, title: 'Trustless Consensus', desc: 'A median of signed scores, within an outlier threshold, decides validity — not a single reviewer.' },
  { icon: KeyRound, title: 'Ed25519-Signed Proofs', desc: 'Every submission and vote is cryptographically signed; balances are real UTXOs on the ledger.' },
];

function FeaturesSection() {
  return (
    <section className="section">
      <div className="section-inner">
        <Reveal className="section-head">
          <span className="eyebrow">Platform</span>
          <h2 className="section-title" style={{ marginBottom: 0 }}>Built for <span className="gradient-text">verifiable trust</span></h2>
          <p className="section-lead">Every guarantee is enforced by cryptography and consensus, not policy.</p>
        </Reveal>

        <motion.div
          className="feature-grid"
          variants={staggerContainer(0.09)}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-70px' }}
        >
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <motion.div key={title} className="feature-card" variants={fadeUp}>
              <span className="fc-icon"><Icon /></span>
              <h3>{title}</h3>
              <p>{desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

/* ── Section 6 — Stats ─────────────────────────────────────────────────────── */
function StatsSection({ reports, findings, minted, blocks }: { reports: number; findings: number; minted: number; blocks: number }) {
  const STATS = [
    { value: reports, name: 'Reports Submitted', decimals: 0, suffix: '' },
    { value: findings, name: 'Verified Findings', decimals: 0, suffix: '' },
    { value: minted, name: 'POC Rewards Minted', decimals: 0, suffix: '' },
    { value: blocks, name: 'Blocks on Chain', decimals: 0, suffix: '' },
  ];
  return (
    <section className="section stats-band">
      <div className="section-inner">
        <Reveal className="section-head">
          <span className="eyebrow">Live Network</span>
          <h2 className="section-title" style={{ marginBottom: 0 }}>The ledger, in numbers</h2>
          <p className="section-lead">Pulled live from the public chain — these update as the protocol is used.</p>
        </Reveal>
        <div className="stats-grid">
          {STATS.map((s) => (
            <Reveal key={s.name} direction="up" className="stat-block">
              <div className="stat-num gradient-text">
                <CountUp value={s.value} decimals={s.decimals} suffix={s.suffix} />
              </div>
              <div className="stat-name">{s.name}</div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Section 7 — Final CTA ─────────────────────────────────────────────────── */
function FinalCta() {
  return (
    <section className="section">
      <div className="section-inner">
        <Reveal>
          <div className="cta-final">
            <NetworkBackground />
            <div className="cta-inner">
              <h2>Ready to <span className="gradient-text">break something</span>?</h2>
              <p className="section-lead" style={{ margin: '0 auto' }}>
                Join the network as a researcher or a validator. Submit a target, prove a crash,
                and earn from an immutable, transparent ledger.
              </p>
              <div className="cta-actions">
                <Link to="/login" className="btn btn-primary"><Rocket /> Join the Platform</Link>
                <Link to="/submit" className="btn btn-secondary"><Bug /> Start Reporting</Link>
                <Link to="/explorer" className="btn btn-ghost"><Blocks /> Explore the Ledger</Link>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
