// FAQ — based on actual README "what Silicon Code deliberately doesn't do" section

const FAQS = [
  {
    q: { zh: '为什么只支持 DeepSeek？能不能换 Claude / GPT？', en: 'Why DeepSeek only? Can I swap to Claude / GPT?' },
    a: {
      zh: '这是产品边界。Silicon Code 先把 DeepSeek 的模型、推理输出和工具调用路径做扎实，再考虑其他 provider。把一个本地编码 agent 做稳定，比堆很多模型入口更重要。',
      en: 'That is the product boundary. Silicon Code focuses first on making the DeepSeek model, reasoning output, and tool path stable before adding more providers. A reliable local coding agent matters more than a long provider list.',
    },
  },
  {
    q: { zh: '需要付费吗？', en: 'Is it free?' },
    a: {
      zh: 'Silicon Code 本身 MIT 开源，完全免费。模型调用使用你自己的 DeepSeek API Key，费用按 DeepSeek 官方 API 计费规则结算。',
      en: 'Silicon Code itself is MIT-licensed and free. Model calls use your own DeepSeek API key and are billed by DeepSeek API pricing.',
    },
  },
  {
    q: { zh: '需要 IDE 插件吗？', en: 'Will there be an IDE plugin?' },
    a: {
      zh: '不会做。Silicon Code 是 terminal-first。diff 留给 git diff，文件树留给 ls。桌面端是配套的可视化伴侣，不是 Cursor 替代品。',
      en: 'No. Silicon Code is terminal-first. `git diff` does diffs; `ls` does file trees. The desktop is a visual companion to the CLI, not a Cursor replacement.',
    },
  },
  {
    q: { zh: '能在内网 / 私有部署的 DeepSeek 上跑吗？', en: 'Can I point it at a self-hosted / private DeepSeek endpoint?' },
    a: {
      zh: '可以。从 0.30 起接受非标准 key 前缀的自托管 DeepSeek 端点。把 baseUrl 改成你的内部地址即可，循环、缓存策略、工具协议都不变。',
      en: 'Yes. Since 0.30 we accept non-standard key prefixes for self-hosted DeepSeek endpoints. Just point `baseUrl` at your internal address — the loop, cache strategy, and tool protocol are unchanged.',
    },
  },
  {
    q: { zh: 'CLI 和桌面端是什么关系？', en: 'How does the CLI relate to the desktop?' },
    a: {
      zh: '完全同一份循环 / 协议 / ~/.brown 配置。桌面端 (Tauri) 自带 Node runtime，无需独立 npm install；多 tab 会话、右侧栏列出当前会话读过和改过的文件，底部显示 cost / cache / token 实时表盘。',
      en: 'Same loop, same protocol, same `~/.siliconcode` config. The desktop (Tauri) bundles its own Node runtime — no separate npm install. Multi-tab sessions, side panel listing files this session read or wrote, live cost / cache / token meters along the bottom.',
    },
  },
  {
    q: { zh: '怎么开发自己的 Skill？', en: 'How do I write my own skill?' },
    a: {
      zh: '没有远程注册表，直接写文件。在 TUI 内 /skill new my-skill 生成项目级模板，--global 写到 ~/.siliconcode/skills 跨项目复用。Skill 是带 frontmatter (description, runAs, allowed-tools) 的 Markdown，runAs: subagent 会在隔离子循环里运行。',
      en: 'No remote registry — just write a file. Inside the TUI run `/skill new my-skill` to scaffold a project-local skill; add `--global` to put it under `~/.siliconcode/skills` for reuse across projects. Skills are Markdown with frontmatter (description, runAs, allowed-tools); `runAs: subagent` runs the body in an isolated sub-loop.',
    },
  },
  {
    q: { zh: '工具调用是否安全？', en: 'Are tool calls safe?' },
    a: {
      zh: '所有原生工具 (read_file / write_file / edit_file / run_command 等) 都沙箱化到启动目录，--dir 显式指定。SEARCH/REPLACE 编辑默认进 pending 队列，/apply 才落盘。/plan 进入只读审计门，未批准计划前不允许写入。',
      en: 'Every built-in tool (`read_file` / `write_file` / `edit_file` / `run_command` …) is sandboxed to the launch directory or whatever you set via `--dir`. SEARCH/REPLACE edits queue as pending; nothing hits disk until you `/apply`. `/plan` mode is a read-only audit gate — no writes allowed until the plan is approved.',
    },
  },
  {
    q: { zh: '能切换工作目录吗？', en: 'Can I switch working directories mid-session?' },
    a: {
      zh: '不能在 session 中途切。memory 路径会与陈旧的根目录纠缠。退出后 brown code --dir <path> 重新启动即可。',
      en: 'No — memory paths would tangle with the stale root. Exit and relaunch with `brown code --dir <path>`.',
    },
  },
];

function Faq() {
  const [open, setOpen] = React.useState(0);
  const { lang } = useLang();
  return (
    <section className="section" id="faq">
      <SecHead
        num="08"
        label="FAQ"
        title={t({ zh: '高频<em>问题</em>。', en: 'Frequently <em>asked</em>.' }, lang)}
        sub={t({
          zh: '仍有疑问？欢迎到 GitHub Discussions 提问。',
          en: 'Still stuck? Open a thread in GitHub Discussions.',
        }, lang)}
      />

      <div className="faq-list">
        {FAQS.map((f, i) => (
          <div key={i} className={'faq-item ' + (open === i ? 'open' : '')}>
            <div className="faq-q" onClick={() => setOpen(open === i ? -1 : i)}>
              <span className="idx">{String(i + 1).padStart(2, '0')}</span>
              <span style={{flex:1}}>{t(f.q, lang)}</span>
              <Ic.Chev className="chev"/>
            </div>
            <div className="faq-a">{t(f.a, lang)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

window.Faq = Faq;
