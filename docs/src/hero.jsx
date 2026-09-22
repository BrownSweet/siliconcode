// Hero — animated terminal showing a real Silicon Code coding session

// Based on the actual brown code TUI: cache-first loop, SEARCH/REPLACE edits,
// tool calls sandboxed to launch dir.
const TERM_SCRIPT = [
  { t: 'cmd', text: 'npm install -g @brownsweet/siliconcode' },
  { t: 'out', text: '+ @brownsweet/siliconcode installed', cls: 'term-ok', delay: 240 },
  { t: 'blank' },
  { t: 'cmd', text: 'brown' },
  { t: 'out', text: `Silicon Code ${window.SILICONCODE_VERSION} · model deepseek-v4-flash`, cls: 'term-info', delay: 260 },
  { t: 'out', text: 'rules loaded · AGENTS.md · workspace ~/app', cls: 'term-dim', delay: 220 },
  { t: 'blank' },
  { t: 'cmd', text: 'fix the case-sensitivity bug in findByEmail' },
  { t: 'out', text: 'plan · inspect files, reproduce test, patch, rerun', cls: 'term-dim', delay: 260 },
  { t: 'out', text: 'read_file · src/users.ts', cls: 'term-dim', delay: 220 },
  { t: 'out', text: 'run_command · npm test users', cls: 'term-info', delay: 280 },
  { t: 'out', text: '1 failing · findByEmail should ignore case', cls: 'term-warn', delay: 180 },
  { t: 'out', text: 'src/users.ts', cls: 'term-warn', delay: 180 },
  { t: 'out', text: '<<<<<<< SEARCH', cls: 'term-dim', delay: 80 },
  { t: 'out', text: '  return users.find(u => u.email === email);', delay: 80 },
  { t: 'out', text: '=======', cls: 'term-dim', delay: 80 },
  { t: 'out', text: '  const needle = email.toLowerCase();', cls: 'term-ok', delay: 80 },
  { t: 'out', text: '  return users.find(u => u.email.toLowerCase() === needle);', cls: 'term-ok', delay: 80 },
  { t: 'out', text: '>>>>>>> REPLACE', cls: 'term-dim', delay: 80 },
  { t: 'out', text: 'edit pending · approve to apply', cls: 'term-info', delay: 240 },
  { t: 'blank' },
  { t: 'cmd', text: '/apply' },
  { t: 'out', text: 'wrote src/users.ts · 2 lines changed', cls: 'term-ok', delay: 200 },
  { t: 'out', text: 'npm test users · passed', cls: 'term-ok', delay: 220 },
];

const INITIAL_TERM_LINES = TERM_SCRIPT.slice(0, 6);

function Terminal() {
  const [lines, setLines] = React.useState(INITIAL_TERM_LINES);
  const [typing, setTyping] = React.useState('');
  const stepRef = React.useRef(INITIAL_TERM_LINES.length);
  const charRef = React.useRef(0);

  React.useEffect(() => {
    let cancelled = false;
    let timer;

    const run = () => {
      if (cancelled) return;
      const i = stepRef.current;
      if (i >= TERM_SCRIPT.length) {
        timer = setTimeout(() => {
          if (cancelled) return;
          stepRef.current = INITIAL_TERM_LINES.length;
          charRef.current = 0;
          setLines(INITIAL_TERM_LINES);
          run();
        }, 3600);
        return;
      }
      const step = TERM_SCRIPT[i];
      if (step.t === 'cmd') {
        const text = step.text;
        if (charRef.current < text.length) {
          setTyping(text.slice(0, charRef.current + 1));
          charRef.current += 1;
          timer = setTimeout(run, 22 + Math.random() * 28);
        } else {
          setLines(prev => [...prev, { ...step, text }]);
          setTyping('');
          charRef.current = 0;
          stepRef.current += 1;
          timer = setTimeout(run, 380);
        }
      } else if (step.t === 'blank') {
        setLines(prev => [...prev, step]);
        stepRef.current += 1;
        timer = setTimeout(run, 240);
      } else {
        setLines(prev => [...prev, step]);
        stepRef.current += 1;
        timer = setTimeout(run, step.delay || 180);
      }
    };

    timer = setTimeout(run, 600);
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  return (
    <div className="terminal" role="presentation" aria-hidden="true">
      <div className="term-head">
        <div className="term-dots"><i></i><i></i><i></i></div>
        <span className="term-title">~/app  ·  brown code</span>
        <div className="term-tabs">
          <span className="term-tab on">session</span>
          <span className="term-tab">events</span>
          <span className="term-tab">+</span>
        </div>
      </div>
      <div className="term-body">
        {lines.map((l, i) => {
          if (l.t === 'blank') return <div key={i} className="term-line">&nbsp;</div>;
          if (l.t === 'cmd') {
            return (
              <div key={i} className="term-line">
                <span className="term-prompt-user">›</span>
                <span className="term-cmd">{l.text}</span>
              </div>
            );
          }
          return (
            <div key={i} className={'term-line ' + (l.cls || '')}>{l.text}</div>
          );
        })}
        {typing !== '' ? (
          <div className="term-line">
            <span className="term-prompt-user">›</span>
            <span className="term-cmd">{typing}</span>
            <span className="cursor"></span>
          </div>
        ) : (
          lines.length > 0 && stepRef.current < TERM_SCRIPT.length && (
            <div className="term-line"><span className="term-prompt-user">›</span><span className="cursor"></span></div>
          )
        )}
      </div>
    </div>
  );
}

function Hero() {
  const { lang } = useLang();
  return (
    <section className="hero" id="top">
      <div className="hero-head">
        <span>§00 · Silicon Code</span>
        <span className="rule"></span>
        <span className="v">v{window.SILICONCODE_VERSION} · open source</span>
      </div>
      <div className="hero-grid">
        <div>
          {lang === 'en' ? (
            <h1>Silicon Code</h1>
          ) : (
            <h1>Silicon Code</h1>
          )}
          <p className="lede">
            {t({
              zh: <>DeepSeek 驱动的终端代码智能体。进入仓库，描述任务，Silicon Code 会读取代码、规划修改、展示 diff、请求命令确认，并运行验证。</>,
              en: <>DeepSeek-powered terminal coding agent. Open a repository, describe a task, review the diff, approve commands, and let Silicon Code run validation.</>,
            }, lang)}
          </p>
          <div className="hero-install">
            <CopyCmd cmd="npm install -g @brownsweet/siliconcode" />
          </div>
          <div className="hero-actions">
            <a className="btn btn-primary" href="#install">
              {t({ zh: '查看安装', en: 'Install' }, lang)}
            </a>
            <a className="btn btn-ghost" href="https://github.com/BrownSweet/siliconcode" target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a className="btn btn-ghost" href="https://www.npmjs.com/package/@brownsweet/siliconcode" target="_blank" rel="noreferrer">
              npm
            </a>
          </div>
          <p className="hero-note">
            <span>brown GitHub</span>
            <span>@brownsweet/siliconcode</span>
            <span>MIT</span>
          </p>
        </div>
        <div style={{position:'relative'}}>
          <Terminal/>
        </div>
      </div>
    </section>
  );
}

window.Hero = Hero;
