/**
 * DSH Token Saver — Web Client Settings UI
 *
 * Provides settings panel for Global Token Saver:
 * - Master enable switch
 * - Real-time RTK tool output compression switch
 * - Prompt shaping level selectors (Caveman, Ponytail)
 * - Local zero-token responses configuration (Quota, Prefix, Title, Suggestion, Filepath)
 * - Live savings telemetry dashboard
 */

;(function () {
  'use strict'

  if (typeof window === 'undefined' || !window.__ModuleLoader__) return

  window.__ModuleLoader__.load({
    id: 'dsh-token-saver',
    factory: function (require) {
      const React = require('react')
      const { useState, useEffect, useCallback, createElement: h } = React

      const NS = 'settings.tokenSaver'

      const DICT = {
        zh: {
          'saver.title': 'Token 节省',
          'saver.tab': 'Token 节省',
          'saver.card.title': '全局 Token 节省',
          'saver.card.desc': '通过实时工具输出压缩、提示词精简与本地直答，在不影响模型推理质量的前提下大幅降低上下文消耗与调用延迟。',
          'saver.master.name': '总开关',
          'saver.master.desc': '启用或停用全局 Token 节省功能；关闭时所有请求原样传递',
          'saver.meter.title': '节省统计',
          'saver.meter.empty': '暂无调用数据',
          'saver.meter.saved': '已节省',
          'saver.meter.savedRatio': '节省比例',
          'saver.meter.calls': '生效请求',
          'saver.meter.blocks': '压缩块数',
          'saver.meter.before': '原始大小',
          'saver.meter.after': '压缩后',
          'saver.prompts.title': '提示词塑形 (Prompt Shaping)',
          'saver.prompts.desc': '在不损失核心约束的前提下对系统提示词与历史消息进行密度重塑',
          'saver.prompts.caveman': 'Caveman 压缩',
          'saver.prompts.cavemanDesc': '精简提示词中的冗余表述与连接词，保留核心技术指令',
          'saver.prompts.ponytail': 'Ponytail 风格',
          'saver.prompts.ponytailDesc': '高级开发者懒人模式：极简答复、拒绝过度工程化',
          'saver.rtk.title': '工具输出压缩 (RTK)',
          'saver.rtk.desc': '自动精简 git diff、status、log、grep、find、ls、tree 等高频命令行输出，移除冗余空格与无用元数据',
          'saver.rtk.name': '实时压缩',
          'saver.rtk.switchDesc': '对终端和工具调用结果进行智能结构化瘦身',
          'saver.local.title': '本地零消耗直答 (Local Answers)',
          'saver.local.desc': '常见固定模式由本地内核 0ms、0 Token 直接响应，免除远程模型调用',
          'saver.local.master': '启用本地直答',
          'saver.local.masterDesc': '关闭时所有提问均发送给模型',
          'saver.local.quota': '配额与额度查询',
          'saver.local.quotaDesc': '匹配配额、剩余额度、用量查询提问',
          'saver.local.prefix': '系统前缀探针',
          'saver.local.prefixDesc': '匹配前缀探测与握手指令',
          'saver.local.titleOpt': '对话标题生成',
          'saver.local.titleDesc': '本地抽取会话关键词生成标题',
          'saver.local.suggestion': '后续建议生成',
          'saver.local.suggestionDesc': '本地规则模板生成下一步建议',
          'saver.local.filepath': '路径与文件定位',
          'saver.local.filepathDesc': '本地快速路径匹配与文件补全',
          'saver.level.off': '关闭',
          'saver.level.lite': '轻度',
          'saver.level.normal': '标准',
          'saver.level.hard': '紧凑',
          'saver.level.extreme': '极限',
          'saver.level.full': '完整',
          'saver.level.ultra': '超极简',
          'saver.saved': '设置已保存',
          'saver.savedBody': '新的 Token 节省策略已生效',
          'saver.failed': '保存失败',
        },
        en: {
          'saver.title': 'Token Saver',
          'saver.tab': 'Token Saver',
          'saver.card.title': 'Global Token Saver',
          'saver.card.desc': 'Significantly reduce context consumption and latency via tool output compression, prompt shaping, and local responses.',
          'saver.master.name': 'Master Switch',
          'saver.master.desc': 'Enable or disable global token saving; all requests pass through untouched when off',
          'saver.meter.title': 'Savings Stats',
          'saver.meter.empty': 'No data recorded yet',
          'saver.meter.saved': 'Tokens Saved',
          'saver.meter.savedRatio': 'Saved Ratio',
          'saver.meter.calls': 'Calls Handled',
          'saver.meter.blocks': 'Blocks Trimmed',
          'saver.meter.before': 'Original Size',
          'saver.meter.after': 'Compressed Size',
          'saver.prompts.title': 'Prompt Shaping',
          'saver.prompts.desc': 'Reshape system prompts and conversation history density without losing constraints',
          'saver.prompts.caveman': 'Caveman Compression',
          'saver.prompts.cavemanDesc': 'Trim grammatical filler and verbose phrasing from prompts',
          'saver.prompts.ponytail': 'Ponytail Style',
          'saver.prompts.ponytailDesc': 'Senior developer lazy mode: concise replies, anti-overengineering',
          'saver.rtk.title': 'Tool Output Compression (RTK)',
          'saver.rtk.desc': 'Automatically trim redundant terminal output from git diff, status, log, grep, find, ls, tree, etc.',
          'saver.rtk.name': 'Real-time Compression',
          'saver.rtk.switchDesc': 'Intelligently strip boilerplate from tool execution results',
          'saver.local.title': 'Local Zero-Token Answers',
          'saver.local.desc': 'Serve common mechanical queries locally in 0ms with 0 tokens consumed',
          'saver.local.master': 'Enable Local Answers',
          'saver.local.masterDesc': 'When disabled, all queries are sent to remote LLM models',
          'saver.local.quota': 'Quota & Balance Query',
          'saver.local.quotaDesc': 'Matches balance, quota, and usage inquiries',
          'saver.local.prefix': 'System Prefix Probes',
          'saver.local.prefixDesc': 'Matches handshake and prefix detection probes',
          'saver.local.titleOpt': 'Session Title Generation',
          'saver.local.titleDesc': 'Locally extracts conversation keywords for title',
          'saver.local.suggestion': 'Follow-up Suggestions',
          'saver.local.suggestionDesc': 'Generates next-step suggestions using local templates',
          'saver.local.filepath': 'Path & File Resolution',
          'saver.local.filepathDesc': 'Fast local path matching and file resolution',
          'saver.level.off': 'Off',
          'saver.level.lite': 'Lite',
          'saver.level.normal': 'Normal',
          'saver.level.hard': 'Hard',
          'saver.level.extreme': 'Extreme',
          'saver.level.full': 'Full',
          'saver.level.ultra': 'Ultra',
          'saver.saved': 'Settings Saved',
          'saver.savedBody': 'Token saver settings updated successfully',
          'saver.failed': 'Save Failed',
        },
      }

      function localeTag(ctx) {
        try {
          const l = ctx?.i18n?.locale || navigator.language
          return l && l.toLowerCase().startsWith('zh') ? 'zh' : 'en'
        } catch {
          return 'zh'
        }
      }

      function createTranslator(ctx) {
        const lang = localeTag(ctx)
        const dict = DICT[lang] || DICT.zh
        return function (key) {
          return dict[key] || DICT.en[key] || key
        }
      }

      const CSS = `
.dts_root {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 860px;
  margin: 0 auto;
  padding: 16px 20px 48px;
  font-family: inherit;
  color: var(--dsw-alias-label-primary, #1e293b);
}
.dts_card {
  border-radius: 14px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.08));
  background: var(--dsw-alias-bg-layer-1, rgba(255,255,255,0.85));
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}
.dts_header {
  margin-bottom: 16px;
}
.dts_title {
  font-size: 16px;
  font-weight: 650;
  margin: 0 0 4px 0;
  color: var(--dsw-alias-label-primary, #0f172a);
}
.dts_desc {
  font-size: 12.5px;
  color: var(--dsw-alias-label-secondary, #64748b);
  margin: 0;
  line-height: 1.5;
}
.dts_stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 12px;
  margin-top: 14px;
}
.dts_stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.06));
  background: var(--dsw-alias-bg-layer-2, rgba(248,250,252,0.7));
}
.dts_stat b {
  font-size: 18px;
  font-weight: 700;
  color: var(--dsw-alias-accent, #3b82f6);
}
.dts_stat span {
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary, #64748b);
}
.dts_row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.04));
  gap: 16px;
}
.dts_row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
.dts_row_info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}
.dts_row_label {
  font-size: 13.5px;
  font-weight: 550;
  color: var(--dsw-alias-label-primary, #0f172a);
}
.dts_row_desc {
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary, #64748b);
}
.dts_seg {
  display: inline-flex;
  padding: 3px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.1));
  background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.03));
  gap: 2px;
}
.dts_seg button {
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #64748b);
  font: inherit;
  font-size: 11.5px;
  font-weight: 550;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: all .16s ease;
}
.dts_seg button:hover {
  color: var(--dsw-alias-label-primary, #0f172a);
}
.dts_seg button[aria-pressed="true"] {
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  color: var(--dsw-alias-accent, #3b82f6);
  font-weight: 650;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}
.dts_switch {
  position: relative;
  display: inline-block;
  width: 42px;
  height: 24px;
}
.dts_switch input {
  opacity: 0;
  width: 0;
  height: 0;
}
.dts_slider {
  position: absolute;
  cursor: pointer;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: var(--dsw-alias-border-l1, #cbd5e1);
  transition: .24s;
  border-radius: 24px;
}
.dts_slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: .24s;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}
.dts_switch input:checked + .dts_slider {
  background-color: var(--dsw-alias-accent, #3b82f6);
}
.dts_switch input:checked + .dts_slider:before {
  transform: translateX(18px);
}
.dts_pill {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 12px;
  background: rgba(59, 130, 246, 0.1);
  color: var(--dsw-alias-accent, #3b82f6);
  margin-left: 8px;
}
.dts_toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  padding: 10px 18px;
  border-radius: 8px;
  background: #1e293b;
  color: white;
  font-size: 12.5px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  z-index: 99999;
  transition: opacity .2s ease;
}
`

      function injectStyleOnce() {
        if (typeof document === 'undefined') return
        const ID = 'dsh-token-saver-styles'
        if (document.getElementById(ID)) return
        const style = document.createElement('style')
        style.id = ID
        style.textContent = CSS
        document.head.appendChild(style)
      }

      const API = (() => {
        try {
          return new URL('api/token-saver', document.baseURI).pathname
        } catch {
          return '/api/token-saver'
        }
      })()

      async function api(path, options) {
        const { timeout = 8000, ...fetchOptions } = options ?? {}
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), timeout)
        try {
          const response = await fetch(`${API}${path}`, {
            ...fetchOptions,
            redirect: 'error',
            signal: ctrl.signal,
          })
          const text = await response.text()
          let payload
          try {
            payload = text === '' ? {} : JSON.parse(text)
          } catch {
            payload = { error: text.slice(0, 200) }
          }
          if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`)
          return payload
        } finally {
          clearTimeout(timer)
        }
      }

      const post = (path, body, timeout) =>
        api(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          ...(timeout === undefined ? {} : { timeout }),
        })

      function showToast(title, body) {
        if (typeof document === 'undefined') return
        const el = document.createElement('div')
        el.className = 'dts_toast'
        el.textContent = title + (body ? `: ${body}` : '')
        document.body.appendChild(el)
        setTimeout(() => {
          el.style.opacity = '0'
          setTimeout(() => el.remove(), 250)
        }, 2800)
      }

      function Switch(props) {
        const { checked, onChange, disabled } = props
        return h(
          'label',
          { className: 'dts_switch' },
          h('input', {
            type: 'checkbox',
            checked: !!checked,
            disabled,
            onChange: (e) => onChange(e.target.checked),
          }),
          h('span', { className: 'dts_slider' }),
        )
      }

      function LevelPicker(props) {
        const { value, levels, labels, onChange, disabled } = props
        return h(
          'div',
          { className: 'dts_seg', role: 'group' },
          levels.map((lvl) =>
            h(
              'button',
              {
                key: lvl,
                type: 'button',
                'aria-pressed': value === lvl,
                disabled,
                onClick: () => onChange(lvl),
              },
              labels[lvl] || lvl,
            ),
          ),
        )
      }

      const fmtInt = (n) =>
        typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString() : '0'

      const fmtKb = (bytes) => {
        if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '0 B'
        if (bytes < 1024) return bytes + ' B'
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
      }

      function SaverPage(props) {
        const t = createTranslator(props.ctx)
        const [saver, setSaver] = useState(null)
        const [local, setLocal] = useState(null)
        const [loading, setLoading] = useState(true)
        const [error, setError] = useState('')
        const [busy, setBusy] = useState('')

        useEffect(() => {
          injectStyleOnce()
          let alive = true
          Promise.all([api('/token-saver'), api('/local-optimize')])
            .then(([s, l]) => {
              if (!alive) return
              setSaver(s)
              setLocal(l)
              setLoading(false)
            })
            .catch((err) => {
              if (!alive) return
              setError(err.message || String(err))
              setLoading(false)
            })
          return () => {
            alive = false
          }
        }, [])

        const saveSaver = (patch) => {
          setBusy('saver')
          post('/token-saver', patch)
            .then((ans) => {
              setSaver((prev) => ({
                ...ans.tokenSaver,
                savings: prev?.savings ?? ans.tokenSaver?.savings,
              }))
              showToast(t('saver.saved'), t('saver.savedBody'))
            })
            .catch((err) => {
              showToast(t('saver.failed'), err.message || String(err))
            })
            .finally(() => setBusy(''))
        }

        const saveLocal = (patch) => {
          setBusy('local')
          post('/local-optimize', patch)
            .then((ans) => {
              setLocal(ans.localOptimize)
              showToast(t('saver.saved'), t('saver.savedBody'))
            })
            .catch((err) => {
              showToast(t('saver.failed'), err.message || String(err))
            })
            .finally(() => setBusy(''))
        }

        if (loading) {
          return h('div', { className: 'dts_root' }, h('p', null, 'Loading Token Saver settings...'))
        }

        if (error) {
          return h(
            'div',
            { className: 'dts_root' },
            h('p', { style: { color: 'red' } }, `Failed to load settings: ${error}`),
          )
        }

        const savings = saver?.savings
        const levelLabels = {
          off: t('saver.level.off'),
          lite: t('saver.level.lite'),
          normal: t('saver.level.normal'),
          hard: t('saver.level.hard'),
          extreme: t('saver.level.extreme'),
          full: t('saver.level.full'),
          ultra: t('saver.level.ultra'),
        }

        return h(
          'div',
          { className: 'dts_root' },

          // Card 1: Overview & Master switch
          h(
            'div',
            { className: 'dts_card' },
            h(
              'div',
              { className: 'dts_header' },
              h('h2', { className: 'dts_title' }, t('saver.card.title'), h('span', { className: 'dts_pill' }, 'Active')),
              h('p', { className: 'dts_desc' }, t('saver.card.desc')),
            ),
            h(
              'div',
              { className: 'dts_row' },
              h(
                'div',
                { className: 'dts_row_info' },
                h('span', { className: 'dts_row_label' }, t('saver.master.name')),
                h('span', { className: 'dts_row_desc' }, t('saver.master.desc')),
              ),
              h(Switch, {
                checked: saver?.enabled !== false,
                disabled: !!busy,
                onChange: (checked) => saveSaver({ enabled: checked }),
              }),
            ),
            // Savings statistics
            h(
              'div',
              { className: 'dts_stats' },
              h(
                'div',
                { className: 'dts_stat' },
                h('b', null, savings?.percent ? `${savings.percent}%` : '0%'),
                h('span', null, t('saver.meter.savedRatio')),
              ),
              h(
                'div',
                { className: 'dts_stat' },
                h('b', null, fmtKb(savings?.saved ?? 0)),
                h('span', null, t('saver.meter.saved')),
              ),
              h(
                'div',
                { className: 'dts_stat' },
                h('b', null, fmtInt(savings?.calls ?? 0)),
                h('span', null, t('saver.meter.calls')),
              ),
              h(
                'div',
                { className: 'dts_stat' },
                h('b', null, fmtInt(savings?.blocks ?? 0)),
                h('span', null, t('saver.meter.blocks')),
              ),
            ),
          ),

          // Card 2: RTK Tool Result Compression
          h(
            'div',
            { className: 'dts_card' },
            h(
              'div',
              { className: 'dts_header' },
              h('h3', { className: 'dts_title' }, t('saver.rtk.title')),
              h('p', { className: 'dts_desc' }, t('saver.rtk.desc')),
            ),
            h(
              'div',
              { className: 'dts_row' },
              h(
                'div',
                { className: 'dts_row_info' },
                h('span', { className: 'dts_row_label' }, t('saver.rtk.name')),
                h('span', { className: 'dts_row_desc' }, t('saver.rtk.switchDesc')),
              ),
              h(Switch, {
                checked: !!saver?.rtk,
                disabled: !!busy || saver?.enabled === false,
                onChange: (checked) => saveSaver({ rtk: checked }),
              }),
            ),
          ),

          // Card 3: Prompt Shaping (Caveman & Ponytail)
          h(
            'div',
            { className: 'dts_card' },
            h(
              'div',
              { className: 'dts_header' },
              h('h3', { className: 'dts_title' }, t('saver.prompts.title')),
              h('p', { className: 'dts_desc' }, t('saver.prompts.desc')),
            ),
            h(
              'div',
              { className: 'dts_row' },
              h(
                'div',
                { className: 'dts_row_info' },
                h('span', { className: 'dts_row_label' }, t('saver.prompts.caveman')),
                h('span', { className: 'dts_row_desc' }, t('saver.prompts.cavemanDesc')),
              ),
              h(LevelPicker, {
                value: saver?.prompts?.caveman ?? 'off',
                levels: saver?.cavemanLevels ?? ['off', 'lite', 'normal', 'hard', 'extreme', 'ultra'],
                labels: levelLabels,
                disabled: !!busy || saver?.enabled === false,
                onChange: (lvl) => saveSaver({ prompts: { ...saver?.prompts, caveman: lvl } }),
              }),
            ),
            h(
              'div',
              { className: 'dts_row' },
              h(
                'div',
                { className: 'dts_row_info' },
                h('span', { className: 'dts_row_label' }, t('saver.prompts.ponytail')),
                h('span', { className: 'dts_row_desc' }, t('saver.prompts.ponytailDesc')),
              ),
              h(LevelPicker, {
                value: saver?.prompts?.ponytail ?? 'off',
                levels: saver?.ponytailLevels ?? ['off', 'lite', 'full', 'ultra'],
                labels: levelLabels,
                disabled: !!busy || saver?.enabled === false,
                onChange: (lvl) => saveSaver({ prompts: { ...saver?.prompts, ponytail: lvl } }),
              }),
            ),
          ),

          // Card 4: Local Answers (Five Zero-Token Responses)
          h(
            'div',
            { className: 'dts_card' },
            h(
              'div',
              { className: 'dts_header' },
              h('h3', { className: 'dts_title' }, t('saver.local.title')),
              h('p', { className: 'dts_desc' }, t('saver.local.desc')),
            ),
            h(
              'div',
              { className: 'dts_row' },
              h(
                'div',
                { className: 'dts_row_info' },
                h('span', { className: 'dts_row_label' }, t('saver.local.master')),
                h('span', { className: 'dts_row_desc' }, t('saver.local.masterDesc')),
              ),
              h(Switch, {
                checked: !!local?.enabled,
                disabled: !!busy || saver?.enabled === false,
                onChange: (checked) => saveLocal({ enabled: checked }),
              }),
            ),
            h(
              'div',
              { className: 'dts_row' },
              h(
                'div',
                { className: 'dts_row_info' },
                h('span', { className: 'dts_row_label' }, t('saver.local.quota')),
                h('span', { className: 'dts_row_desc' }, t('saver.local.quotaDesc')),
              ),
              h(Switch, {
                checked: !!local?.quota,
                disabled: !!busy || saver?.enabled === false || local?.enabled === false,
                onChange: (checked) => saveLocal({ quota: checked }),
              }),
            ),
            h(
              'div',
              { className: 'dts_row' },
              h(
                'div',
                { className: 'dts_row_info' },
                h('span', { className: 'dts_row_label' }, t('saver.local.prefix')),
                h('span', { className: 'dts_row_desc' }, t('saver.local.prefixDesc')),
              ),
              h(Switch, {
                checked: !!local?.prefix,
                disabled: !!busy || saver?.enabled === false || local?.enabled === false,
                onChange: (checked) => saveLocal({ prefix: checked }),
              }),
            ),
            h(
              'div',
              { className: 'dts_row' },
              h(
                'div',
                { className: 'dts_row_info' },
                h('span', { className: 'dts_row_label' }, t('saver.local.titleOpt')),
                h('span', { className: 'dts_row_desc' }, t('saver.local.titleDesc')),
              ),
              h(Switch, {
                checked: !!local?.title,
                disabled: !!busy || saver?.enabled === false || local?.enabled === false,
                onChange: (checked) => saveLocal({ title: checked }),
              }),
            ),
            h(
              'div',
              { className: 'dts_row' },
              h(
                'div',
                { className: 'dts_row_info' },
                h('span', { className: 'dts_row_label' }, t('saver.local.suggestion')),
                h('span', { className: 'dts_row_desc' }, t('saver.local.suggestionDesc')),
              ),
              h(Switch, {
                checked: !!local?.suggestion,
                disabled: !!busy || saver?.enabled === false || local?.enabled === false,
                onChange: (checked) => saveLocal({ suggestion: checked }),
              }),
            ),
            h(
              'div',
              { className: 'dts_row' },
              h(
                'div',
                { className: 'dts_row_info' },
                h('span', { className: 'dts_row_label' }, t('saver.local.filepath')),
                h('span', { className: 'dts_row_desc' }, t('saver.local.filepathDesc')),
              ),
              h(Switch, {
                checked: !!local?.filepath,
                disabled: !!busy || saver?.enabled === false || local?.enabled === false,
                onChange: (checked) => saveLocal({ filepath: checked }),
              }),
            ),
          ),
        )
      }

      return function apply(ctx) {
        const t = createTranslator(ctx)
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'token-saver',
              order: 40,
              label: () => t('saver.title'),
              locale: NS,
            },
            (props) => h(SaverPage, { ...props, locale: localeTag(ctx), ctx }),
          ),
        )
      }
    },
  })
})()
