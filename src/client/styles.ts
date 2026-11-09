// 设置页样式：只使用宿主主题变量，缺失时退回中性色。

export const STYLES = `
.icm-panel{--icm-accent:var(--dsw-alias-brand-primary,#246bce);--icm-ink:var(--dsw-alias-text-primary,#182230);--icm-muted:var(--dsw-alias-text-tertiary,#718096);--icm-border:var(--dsw-alias-border-primary,rgba(100,116,139,.2));--icm-surface:var(--dsw-alias-bg-primary,#fff);--icm-soft:var(--dsw-alias-bg-secondary,#f5f7fa);--icm-ok:var(--dsw-alias-green,#278c61);--icm-danger:var(--dsw-alias-red,#d95d5d);--icm-warn:var(--dsw-alias-orange,#c17a1d);display:flex;flex-direction:column;gap:14px;padding:18px 20px 28px;box-sizing:border-box;color:var(--icm-ink)}
.icm-panel *{box-sizing:border-box}
.icm-header{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap}
.icm-title{margin:0;font-size:20px;font-weight:700;letter-spacing:-.02em}
.icm-subtitle{margin:4px 0 0;color:var(--icm-muted);font-size:12px}
.icm-header-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.icm-pill{display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border:1px solid var(--icm-border);border-radius:999px;font-size:11px;line-height:1.5;color:var(--icm-muted);background:var(--icm-soft);white-space:nowrap}
.icm-pill[data-tone=success]{color:var(--icm-ok);border-color:color-mix(in srgb,var(--icm-ok) 32%,transparent);background:color-mix(in srgb,var(--icm-ok) 10%,transparent)}
.icm-pill[data-tone=danger]{color:var(--icm-danger);border-color:color-mix(in srgb,var(--icm-danger) 32%,transparent);background:color-mix(in srgb,var(--icm-danger) 10%,transparent)}
.icm-pill[data-tone=warning]{color:var(--icm-warn);border-color:color-mix(in srgb,var(--icm-warn) 32%,transparent);background:color-mix(in srgb,var(--icm-warn) 10%,transparent)}
.icm-banner{padding:10px 13px;border:1px solid var(--icm-border);border-radius:8px;background:var(--icm-soft);font-size:12px;line-height:1.6}
.icm-banner[data-tone=danger]{border-color:color-mix(in srgb,var(--icm-danger) 35%,transparent);background:color-mix(in srgb,var(--icm-danger) 9%,transparent);color:var(--icm-danger)}
.icm-banner[data-tone=warning]{border-color:color-mix(in srgb,var(--icm-warn) 35%,transparent);background:color-mix(in srgb,var(--icm-warn) 9%,transparent);color:var(--icm-warn)}
.icm-overview{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.icm-metric{display:flex;flex-direction:column;gap:4px;padding:12px 14px;border:1px solid var(--icm-border);border-radius:10px;background:var(--icm-soft)}
.icm-metric-label{color:var(--icm-muted);font-size:11px}
.icm-metric-value{font-size:22px;line-height:1.15;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.icm-metric[data-tone=danger] .icm-metric-value{color:var(--icm-danger)}
.icm-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:14px;align-items:stretch}
.icm-card{grid-column:span 6;display:flex;flex-direction:column;min-width:0;border:1px solid var(--icm-border);border-radius:14px;padding:18px;background:var(--icm-soft)}
.icm-card--primary{grid-column:span 7}
.icm-card--secondary{grid-column:span 5}
.icm-card--wide{grid-column:1/-1}
.icm-card h3{margin:0;font-size:15px;line-height:1.4}
.icm-card h4{margin:0 0 8px;color:var(--icm-muted);font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase}
.icm-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.icm-card-title{margin:0;font-size:15px;line-height:1.4}
.icm-card-toggle{display:inline-flex;align-items:center;gap:7px;padding:0;border:0;background:none;color:inherit;font:inherit;font-size:15px;font-weight:600;cursor:pointer;text-align:left}
.icm-card-toggle:hover{color:var(--icm-accent)}
.icm-card-toggle:focus-visible{outline:2px solid var(--icm-accent);outline-offset:3px;border-radius:4px}
.icm-chevron{flex:none;width:7px;height:7px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transition:transform .16s ease;margin-left:1px}
.icm-card[data-open=true] .icm-chevron{transform:rotate(45deg)}
.icm-card-body{display:flex;flex-direction:column;flex:1;min-width:0;margin-top:14px}
.icm-card[data-open=false]{align-self:start}
.icm-kv{display:flex;flex-direction:column;gap:8px;margin:0}
.icm-kv-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px;font-size:12px}
.icm-kv-row dt{margin:0;color:var(--icm-muted)}
.icm-kv-row dd{margin:0;text-align:right;overflow-wrap:anywhere}
.icm-note{margin:10px 0 0;color:var(--icm-muted);font-size:12px;line-height:1.6}
.icm-hint{margin:6px 0 0;color:var(--icm-muted);font-size:11px;line-height:1.5}
.icm-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:14px}
.icm-card-body>.icm-actions{margin-top:auto;padding-top:14px}
.icm-btn{display:inline-flex;align-items:center;justify-content:center;min-height:30px;padding:5px 12px;border:1px solid var(--icm-border);border-radius:7px;background:var(--icm-surface);color:var(--icm-ink);font:inherit;font-size:12px;cursor:pointer;transition:border-color .16s ease,background .16s ease}
.icm-btn:hover:not(:disabled){border-color:var(--icm-accent)}
.icm-btn:disabled{opacity:.55;cursor:not-allowed}
.icm-btn--primary{border-color:var(--icm-accent);background:var(--icm-accent);color:#fff}
.icm-btn:focus-visible,.icm-input:focus-visible,.icm-textarea:focus-visible{outline:2px solid var(--icm-accent);outline-offset:2px}
.icm-switch-list{display:flex;flex-direction:column;margin-top:12px;border:1px solid var(--icm-border);border-radius:10px;background:var(--icm-surface);overflow:hidden}
.icm-switch-row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:12px 14px}
.icm-switch-row+.icm-switch-row{border-top:1px solid var(--icm-border)}
.icm-switch-copy{display:flex;flex-direction:column;gap:3px;min-width:0}
.icm-switch-title{font-size:12px;font-weight:600;line-height:1.5}
.icm-switch-row .icm-hint{margin:0}
.icm-field{display:flex;flex-direction:column;gap:6px;margin-top:12px;font-size:12px}
.icm-input,.icm-textarea{min-height:32px;padding:5px 9px;border:1px solid var(--icm-border);border-radius:7px;background:var(--icm-surface);color:inherit;font:inherit;font-size:13px;width:100%}
.icm-textarea{min-height:110px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;line-height:1.6}
.icm-config-stack{display:flex;flex-direction:column;gap:22px;max-width:680px}
.icm-field-block{display:flex;flex-direction:column;min-width:0}
.icm-field-block h4{margin:0}
.icm-field-block>.icm-field{margin-top:10px}
.icm-field-block>.icm-field>.icm-input{max-width:180px}
.icm-actions--head{margin-top:0;padding-top:0;justify-content:flex-end}
.icm-section{display:flex;flex-direction:column;min-width:0}
.icm-section+.icm-section{border-top:1px solid var(--icm-border);padding-top:14px;margin-top:14px}
.icm-section-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.icm-section-head h4{margin:0}
.icm-section--split{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:22px}
.icm-section-col{display:flex;flex-direction:column;min-width:0}
.icm-chips{display:flex;flex-wrap:wrap;gap:6px}
.icm-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border:1px solid var(--icm-border);border-radius:999px;font-size:11px;line-height:1.5;color:var(--icm-muted);background:var(--icm-surface);font-variant-numeric:tabular-nums}
.icm-chip[data-tone=success]{color:var(--icm-ok);border-color:color-mix(in srgb,var(--icm-ok) 32%,transparent);background:color-mix(in srgb,var(--icm-ok) 10%,transparent)}
.icm-chip[data-tone=danger]{color:var(--icm-danger);border-color:color-mix(in srgb,var(--icm-danger) 32%,transparent);background:color-mix(in srgb,var(--icm-danger) 10%,transparent)}
.icm-chip[data-tone=warning]{color:var(--icm-warn);border-color:color-mix(in srgb,var(--icm-warn) 32%,transparent);background:color-mix(in srgb,var(--icm-warn) 10%,transparent)}
.icm-note--danger{color:var(--icm-danger)}
.icm-muted{color:var(--icm-muted)}.icm-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
.icm-table-wrap{margin-top:8px;overflow-x:auto}.icm-table{width:100%;border-collapse:collapse;font-size:11px}
.icm-table td:first-child,.icm-table th:first-child{white-space:normal}
.icm-table th,.icm-table td{text-align:left;padding:6px 7px;border-bottom:1px solid var(--icm-border);white-space:nowrap}
.icm-table th{color:var(--icm-muted);font-weight:600}
.icm-table tr:last-child td{border-bottom:0}
.icm-table--stats td,.icm-table--stats th{text-align:right}
.icm-table--stats td:first-child,.icm-table--stats th:first-child{text-align:left}
.icm-footnote{margin:0;color:var(--icm-muted);font-size:11px;line-height:1.6}
@media (max-width:920px){.icm-card--primary,.icm-card--secondary{grid-column:1/-1}}
@media (max-width:760px){.icm-overview{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:640px){.icm-panel{padding:14px}.icm-kv-row{align-items:flex-start;flex-direction:column;gap:2px}.icm-kv-row dd{text-align:left}}
`;
