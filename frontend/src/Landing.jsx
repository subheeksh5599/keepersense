import React, { useEffect, useRef } from 'react';

const TOOLS = [
  {
    id: 'KS-01',
    name: 'Discover',
    desc: 'Ranked workflow discovery against natural-language intent. Scored matches, confidence levels, no manual browsing.',
    img: '/images/tool-discover.svg',
  },
  {
    id: 'KS-02',
    name: 'Configure',
    desc: 'Input schema resolution. Defaults auto-filled, required parameters flagged, agents told exactly what to supply.',
    img: '/images/tool-configure.svg',
  },
  {
    id: 'KS-03',
    name: 'Deploy',
    desc: 'One-call workflow provisioning by cloning a matched workflow. A fresh workflow instance, ready to execute.',
    img: '/images/tool-deploy.svg',
  },
  {
    id: 'KS-04',
    name: 'Execute',
    desc: 'Trigger, poll, retry. KeeperHub smart gas estimation handles congestion. Returns the transaction hash.',
    img: '/images/tool-execute.svg',
  },
  {
    id: 'KS-05',
    name: 'Audit',
    desc: 'The full trail: trigger, simulation, submitted transaction, gas used, outcome, timestamp. Proof, not promises.',
    img: '/images/tool-audit.svg',
  },
];

const JOURNAL = [
  {
    no: '01',
    title: 'Intent',
    body: 'An agent expresses what it wants in plain language — "protect my vault," "distribute rewards," "monitor this contract." No KeeperHub knowledge required.',
    meta: ['INPUT: natural language', 'TOKENS: ~30', 'MODE: any agent framework'],
  },
  {
    no: '02',
    title: 'Discovery',
    body: 'KeeperSense searches the KeeperHub workflow registry and scores every candidate against the intent. The agent sees ranked matches with confidence scores.',
    meta: ['ENDPOINT: GET /api/workflows/public', 'RANKING: keyword + semantic', 'TOP MATCH: picked or chosen'],
  },
  {
    no: '03',
    title: 'Configuration',
    body: 'The matched workflow\u2019s parameters are resolved from its node configuration and live chain state — balance, block number — so the agent never guesses inputs (KeeperHub\u2019s inputSchema is null).',
    meta: ['ENDPOINT: GET /api/workflows/{id}', 'SOURCE: node config + live chain', 'OUTPUT: ready flag'],
  },
  {
    no: '04',
    title: 'Execution',
    body: 'The workflow is triggered through KeeperHub\u2019s execution engine. Polling until terminal state, with automatic retries on failure.',
    meta: ['ENDPOINT: POST /api/workflows/{id}/execute', 'RETRIES: configurable', 'RESULT: tx hash'],
  },
  {
    no: '05',
    title: 'Audit',
    body: 'Status and logs are pulled and normalized into one audit trail: trigger, simulation, submitted transaction, gas used, outcome, timestamp.',
    meta: ['ENDPOINT: /executions/{id}/status', 'ENDPOINT: /executions/{id}/logs', 'VERIFIABLE: explorer link'],
  },
];

function Reveal({ children, delay = 0 }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            el.classList.add('in');
            io.unobserve(el);
          }
        });
      },
      { threshold: 0.12 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div className="reveal" ref={ref} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

export default function Landing() {
  const stRef = useRef(null);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = stRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const vh = window.innerHeight;
        const offset = (rect.top + rect.height / 2 - vh / 2) * -0.12;
        el.style.transform = `translateY(${offset.toFixed(1)}px)`;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  const marqueeItems = ['Intent', 'Execute', 'Onchain', 'Audit Trail', 'MCP', 'Zero Mockups', 'Sepolia', 'KeeperHub'];
  const mq = [...marqueeItems, ...marqueeItems];

  return (
    <div className="landing">
      <div className="noise" />
      <div className="grid-lines">
        <div className="gl-inner">
          {Array.from({ length: 12 }).map((_, i) => (
            <span key={i} />
          ))}
        </div>
      </div>

      {/* ── header ─────────────────────────────────────────── */}
      <header className="header">
        <div className="h-inner">
          <nav className="h-nav">
            <a href="#tools">Tools</a>
            <a href="#journal">Journal</a>
            <a href="#github">GitHub</a>
          </nav>
          <div className="h-logo">
            <span className="serif-i">Keeper</span>
            <span style={{ fontWeight: 900 }}>SENSE</span>
          </div>
          <a className="h-cta" href="#/app">Launch Pipeline</a>
        </div>
      </header>

      {/* ── hero ───────────────────────────────────────────── */}
      <section className="hero" id="top">
        <div className="container">
          <div className="h-grid">
            <div className="h-left">
              <div className="h-title">
                <div className="stroke-text">Agents</div>
                <div className="serif-i">can reason.</div>
                <div>They act.</div>
              </div>
              <div className="h-actions">
                <a className="btn-start" href="#/app">
                  Start executing
                  <span className="arr">↗</span>
                </a>
                <span className="mono" style={{ color: 'var(--zinc-500)' }}>
                  intent → tx hash
                </span>
              </div>
            </div>

            <div className="h-right">
              <div className="h-frame">
                <img src="/images/hero-pipeline.svg" alt="KeeperSense pipeline: intent to execution through KeeperHub" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── marquee ────────────────────────────────────────── */}
      <div className="marquee">
        <div className="mq-track">
          {mq.map((item, i) => (
            <span className="mq-item" key={i}>
              {i % 2 === 0 ? <span className="stroke-text">{item}</span> : <span className="serif-i">{item}</span>}
              <span className="mq-star">✦</span>
            </span>
          ))}
        </div>
      </div>

      {/* ── tool rows ──────────────────────────────────────── */}
      <section className="tools" id="tools">
        <div className="container">
          {TOOLS.map((t) => (
            <Reveal key={t.id}>
              <a className="proj-row" href="#/app" style={{ display: 'flex' }}>
                <div className="p-main">
                  <span className="p-index">{t.id}</span>
                  <span className="p-name">{t.name}</span>
                  <span className="p-desc">{t.desc}</span>
                </div>
                <div className="p-reveal">
                  <img src={t.img} alt={`${t.name} tool`} />
                  <div className="p-blue" />
                </div>
                <span className="p-view">View ↗</span>
              </a>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── parallax statement ─────────────────────────────── */}
      <section className="statement">
        <div className="st-inner" ref={stRef}>
          <div className="st-line">
            The last mile between what an
          </div>
          <div className="st-line">
            <span className="serif-i">agent decides</span> and a transaction
          </div>
          <div className="st-line">
            that <span className="stroke-text">acts onchain</span>.
          </div>
        </div>
      </section>

      {/* ── journal ────────────────────────────────────────── */}
      <section className="journal" id="journal">
        <div className="container">
          <div className="j-head">
            <span className="label">Technical journal</span>
            <span className="mono" style={{ color: 'var(--zinc-400)' }}>keeperhub.com/api · docs</span>
          </div>
          {JOURNAL.map((j) => (
            <Reveal key={j.no}>
              <div className="j-item">
                <div className="j-no">{j.no}</div>
                <div>
                  <div className="j-title">{j.title}</div>
                  <div className="j-body">{j.body}</div>
                </div>
                <div className="j-meta">
                  {j.meta.map((m) => (
                    <div key={m}>{m}</div>
                  ))}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── CTA strip ──────────────────────────────────────── */}
      <section className="cta-strip" id="github">
        <div className="container">
          <Reveal>
            <div className="cs-title">
              Build the <span className="serif-i">last mile.</span>
            </div>
            <a className="btn-start" href="https://github.com/subheeksh5599/keepersense" target="_blank" rel="noopener noreferrer">
              View source on GitHub
              <span className="arr">↗</span>
            </a>
          </Reveal>
        </div>
      </section>

      {/* ── footer ─────────────────────────────────────────── */}
      <footer className="footer">
        <div className="container f-top">
          <div className="f-label label">KeeperSense — intent to execution</div>
          <a className="f-link" href="https://github.com/subheeksh5599/keepersense" target="_blank" rel="noopener noreferrer">
            github.com/subheeksh5599/keepersense
          </a>
        </div>
        <div className="f-marquee">Keeper Sense Keeper Sense Keeper Sense Keeper Sense Keeper Sense Keeper Sense </div>
        <div className="container f-bottom">
          <div className="f-copy">© 2026 KeeperSense · KeeperHub Agents Onchain Hackathon</div>
        </div>
      </footer>
    </div>
  );
}
