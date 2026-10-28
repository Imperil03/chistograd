(() => {
  'use strict';
  const M = window.ReportModel, data = window.REPORT_DATA;
  if (!M || !data) {
    document.getElementById('panel-plan').innerHTML = '<p class="notice">Не удалось загрузить отчёт. Обновите страницу. Если ошибка повторится, запросите новую ссылку на отчёт.</p>';
    return;
  }
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const paragraphsHTML = value => String(value ?? '').split(/\r?\n\s*\r?\n/).filter(p=>p.trim()).map(p=>`<p>${esc(p)}</p>`).join('');
  const number = value => new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(value);
  const dateLabel = value => value ? new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit'}).format(new Date(value + 'T12:00:00Z')) : '—';
  const icon = (name, cls='') => `<svg class="${cls}" aria-hidden="true" viewBox="0 0 24 24">${{
    arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>', chevron:'<path d="m9 5 7 7-7 7"/>',
    external:'<path d="M7 17 17 7M7 7h10v10"/>', check:'<path d="m5 12 4 4L19 6"/>',
    cycle:'<path d="M19 8a8 8 0 0 0-13-2L3 9m0-5v5h5M5 16a8 8 0 0 0 13 2l3-3m0 5v-5h-5"/>',
    chart:'<path d="M4 3v17h17M9 15v-4m5 4V6m5 9V9"/>', work:'<rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 5V3h6v2m-6 6h6m-6 5h6"/>',
    up:'<path d="M12 20V4m-6 6 6-6 6 6"/>', down:'<path d="M12 4v16m-6-6 6 6 6-6"/>'
  }[name] || ''}</svg>`;
  const tabs = ['plan','baseline','results','works'];
  const baselineReport = data.reports.find(report => report.kind === 'initial' && report.rankings?.after) || data.reports.find(report => report.published && report.rankings?.after);
  const months = data.plan.months.map(stage => stage.month);
  const taskIndex = new Map(M.planTaskEntries(data).map(entry=>[entry.task.id,entry]));
  if (data.plan.table) for (const group of data.plan.table.groups) for (const row of group.rows) {
    taskIndex.set(row.id,{task:{id:row.id,title:row.title,summary:row.purpose,why:row.purpose},matrixRow:row,overview:true});
  }
  const state = {month:M.defaultMonth(data),tab:'plan',detail:null,filters:{search:'',direction:'',trend:'all'},limit:25,engine:'yandex',competitor:''};
  const performanceState = {filters:{search:'',direction:'',trend:'all',cohort:'all'},limit:25,engine:'yandex'};
  let gscSelectedDay=null;
  let performanceView = null, performanceReport = null;
  let view = null, sites = [], lastOpener = null, currentDetail = null, renderedMonth = null;
  const dialog = $('detail-dialog');
  const statusHTML = status => `<span class="status ${status}">${M.STATUS[status]}</span>`;
  const linkHTML = (item, cls='') => {
    const url = M.safeHref(item.url);
    return url ? `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(item.label || item.url)}${icon('external')}</a>` : `<span>${esc(item.label || 'Ссылка недоступна')}</span>`;
  };
  function workCountText(work) {
    if (work.completedCount===undefined) return null;
    const task=taskIndex.get(work.taskId)?.task, total=work.targetCount??task?.target;
    return `Опубликовано ${number(work.completedCount)}${total===undefined?'':' из '+number(total)} ${task?.unit||'страниц'}.`;
  }
  function readRoute() {
    const url = new URL(location.href), month = url.searchParams.get('month'), tab = url.hash.slice(1);
    return {month:months.includes(month) ? month : M.defaultMonth(data),tab:tabs.includes(tab) ? tab : 'plan',detail:url.searchParams.get('task')};
  }
  function routeURL() {
    const url = new URL(location.href);
    url.searchParams.set('month',state.month);
    if (state.detail) url.searchParams.set('task',state.detail); else url.searchParams.delete('task');
    url.hash = state.tab;
    return url;
  }
  function navigate(changes, {replace=false,focusTab=false} = {}) {
    const changedMonth = changes.month && changes.month !== state.month;
    Object.assign(state,changes);
    if (changedMonth) {state.filters={search:'',direction:'',trend:'all'};state.limit=25;resetPerformanceFilters();}
    try {history[replace ? 'replaceState' : 'pushState'](null,'',routeURL());} catch (_) { /* The report also opens from disk. */ }
    render();
    if (focusTab) $('tab-' + state.tab).focus({preventScroll:true});
  }
  function planHTML() {
    if (data.plan.table) return matrixHTML();
    const stages = data.plan.months.map(stage => {
      const status = M.stageStatus(data,stage,state.month);
      const tasks = stage.tasks.map(task => {
        const progress = M.taskProgress(data,task.id,state.month);
        const count = progress.completedCount !== undefined ? `${number(progress.completedCount)} из ${number(progress.targetCount ?? task.target)} страниц опубликовано` : null;
        return `<li><button class="task-button" type="button" data-task="${esc(task.id)}" aria-label="Подробнее: ${esc(task.title)}"><span class="task-text"><span class="task-title">${esc(task.title)}</span><span class="task-summary">${esc(task.summary)}</span>${count ? `<span class="task-target">${esc(count)}</span>` : ''}${progress.status !== 'planned' ? statusHTML(progress.status) : ''}</span><span class="task-affordance">Подробнее</span></button></li>`;
      }).join('');
      const incoming = M.incomingTasks(data,stage.month,state.month).map(item => `<p class="incoming-note">Перенесено на этот месяц: <button type="button" data-task="${esc(item.task.id)}">${esc(item.task.title)}</button>.</p>`).join('');
      return `<li class="stage ${stage.month === state.month ? 'selected' : ''} ${status === 'done' ? 'complete' : ''}" id="stage-${stage.month}"><div class="stage-date"><h3>${M.monthLabel(stage.month,false)}</h3><span class="year">${stage.month.slice(0,4)}</span><span class="stage-node" aria-hidden="true"></span></div><section class="stage-card surface" aria-label="${M.monthLabel(stage.month)}: ${esc(stage.title)}"><div class="stage-heading"><h3>${esc(stage.title)}</h3>${status !== 'planned' ? statusHTML(status) : ''}</div><p class="stage-description">${esc(stage.description)}</p><ul class="stage-tasks">${tasks}</ul>${incoming}</section></li>`;
    }).join('');
    return `<div class="page-intro"><div><h2>План продвижения сайта</h2><p class="period-subtitle">${M.monthLabel(data.project.periodStart)} — ${M.monthLabel(data.project.periodEnd).toLowerCase()}</p></div></div>
      <ol class="timeline">${stages}</ol><p class="plan-footnote">${esc(data.plan.volumeNote)}</p>
      <section class="recurring surface"><h2>Каждый месяц</h2><ul class="recurring-list">${data.plan.recurring.map(item => `<li><div><h3>${esc(item.title)}</h3><p>${esc(item.description)}</p></div></li>`).join('')}</ul></section>`;
  }
  function phaseHTML(value, row) {
    if (value===null) return '<span class="matrix-phase-empty" aria-hidden="true">—</span><span class="sr-only">Работа на этот месяц не обозначена</span>';
    if (value==='●') return '<span class="matrix-dot" role="img" aria-label="Запланировано"></span>';
    if (typeof value==='number') return `<span class="matrix-quantity">${number(value)}<span class="sr-only"> ${esc(row.unit)}</span></span>`;
    const wrapped=value.replace(/Дополнение/g,'Допол\u00adнение').replace(/Актуализация/g,'Акту\u00adали\u00adзация')
      .replace(/Подготовка/g,'Подго\u00adтовка').replace(/Повторный/g,'По\u00adвтор\u00adный')
      .replace(/Контроль/g,'Кон\u00adтроль').replace(/результатам/g,'резуль\u00adтатам').replace(/мониторинга/g,'мони\u00adторинга');
    return `<span class="matrix-phase-label" aria-label="${esc(value)}">${esc(wrapped)}</span>`;
  }
  function matrixHTML() {
    const table=data.plan.table, labels=['Окт.','Ноя.','Дек.','Янв.','Фев.','Март'];
    const intro=table.intro.map((paragraph,i)=>{
      const cut=i===0?paragraph.indexOf('.')+1:paragraph.indexOf(':')+1;
      return `<p><strong>${esc(paragraph.slice(0,cut))}</strong>${esc(paragraph.slice(cut))}</p>`;
    }).join('');
    const body=table.groups.map(group=>`<tbody><tr class="matrix-group-row"><th colspan="8" scope="colgroup"><span>${esc(group.title)}</span></th></tr>${group.rows.map(row=>`<tr class="matrix-work-row"><th scope="row" id="matrix-work-${esc(row.id)}"><button type="button" class="matrix-work-button" data-task="${esc(row.id)}" aria-label="Подробнее: ${esc(row.title)}">${esc(row.title)}</button><span class="matrix-purpose-mobile">${esc(row.purpose)}</span></th><td class="matrix-purpose" headers="matrix-work-${esc(row.id)} matrix-purpose-heading">${esc(row.purpose)}</td>${table.months.map(month=>`<td class="matrix-phase ${state.month===month?'is-selected':''}" data-month="${month}" headers="matrix-work-${esc(row.id)} matrix-month-${month}"><span class="matrix-cell-month" aria-hidden="true">${M.monthLabel(month)}</span>${phaseHTML(row.schedule[month],row)}</td>`).join('')}</tr>`).join('')}</tbody>`).join('');
    return `<div class="page-intro"><div><h2>План продвижения сайта</h2><p class="period-subtitle">${M.monthLabel(data.project.periodStart)} — ${M.monthLabel(data.project.periodEnd).toLowerCase()}</p></div></div><div class="plan-introduction">${intro}</div><section class="plan-matrix surface"><div class="matrix-container" id="plan-matrix" role="region" aria-label="План работ на шесть месяцев"><table class="matrix-table"><caption class="sr-only">План работ на октябрь 2026 — март 2027. Отметки обозначают запланированные работы и этапы.</caption><colgroup><col class="matrix-work-col"><col class="matrix-purpose-col">${table.months.map(()=>'<col class="matrix-month-col">').join('')}</colgroup><thead><tr><th scope="col" class="matrix-work-heading">Работы</th><th scope="col" class="matrix-purpose-heading" id="matrix-purpose-heading">Для чего</th>${table.months.map((month,i)=>`<th scope="col" class="matrix-month-heading ${state.month===month?'is-selected':''}" data-month="${month}" id="matrix-month-${month}" aria-label="${M.monthLabel(month)}">${labels[i]}<small>${month.slice(0,4)}</small></th>`).join('')}</tr></thead>${body}</table></div></section><p class="matrix-legend">● — работа запланирована. Числа — количество материалов.</p>`;
  }
  function pendingHTML(kind) {
    const month = M.monthLabel(state.month).toLocaleLowerCase('ru-RU');
    return `<div class="empty-state surface"><div class="empty-symbol">${icon(kind === 'results' ? 'chart' : 'work')}</div><div><h2>Отчёт за ${esc(month)} ещё не подготовлен</h2><p>${kind === 'results' ? 'Здесь появятся поисковый трафик, позиции сайта и сравнение с предыдущим месяцем. Ближайшие работы уже собраны в плане продвижения.' : 'После подготовки отчёта здесь будут выполненные работы: что изменили, зачем и где посмотреть результат. Запланированные задачи доступны в маршруте на полгода.'}</p><button type="button" class="button-primary" data-view="plan">Смотреть план на ${esc(M.monthLabel(state.month,false).toLowerCase())}${icon('arrow')}</button></div></div>
      `;
  }
  function trafficChart() {
    const history = M.trafficHistory(data,state.month), actual = history.filter(item => item.visits !== null);
    if (actual.length < 2) return '<p class="chart-placeholder">График появится, когда будут данные за два полных месяца.</p>';
    const desc=history.map(item => `${M.monthLabel(item.month)}: ${item.visits === null ? 'нет данных' : number(item.visits) + ' визитов'}`).join('; ');
    return [540,320].map(width => {
      const height=150,max=Math.max(1,...actual.map(item=>item.visits)),step=width/history.length,barWidth=width===320?24:32;
      const bars=history.map((item,index) => {
        const x=index*step+step/2,h=item.visits===null?0:item.visits/max*88;
        const label=M.monthLabel(item.month,false).slice(0,3).toLowerCase();
        const count=item.visits>=10000?new Intl.NumberFormat('ru-RU',{notation:'compact',maximumFractionDigits:1}).format(item.visits):number(item.visits);
        return `${item.visits===null?`<text x="${x}" y="108" text-anchor="middle">—</text>`:`<rect x="${x-barWidth/2}" y="${111-h}" width="${barWidth}" height="${Math.max(h,1)}" rx="3" fill="${item.month===state.month?'#5953cf':'#b4ade9'}" stroke="none"><title>${M.monthLabel(item.month)}: ${number(item.visits)} визитов</title></rect><text class="bar-label" x="${x}" y="${102-h}" text-anchor="middle">${count}</text>`}<text x="${x}" y="136" text-anchor="middle">${label}${item.month.endsWith('-01')?' '+item.month.slice(2,4):''}</text>`;
      }).join('');
      return `<svg class="traffic-chart ${width===320?'chart-mobile':'chart-desktop'}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Поисковый трафик по месяцам"><title>Поисковый трафик</title><desc>${esc(desc)}</desc><path d="M0 112h${width}" stroke="#e4e9f1"/>${bars}</svg>`;
    }).join('');
  }
  function trafficHTML() {
    const {current,before,difference,percent} = M.trafficComparison(data,state.month);
    if (!current) return '';
    const sign=difference > 0 ? '+' : difference < 0 ? '−' : '';
    const trend=difference > 0 ? 'positive' : difference < 0 ? 'negative' : 'neutral';
    const change = difference === null ? 'Нет сопоставимых данных за предыдущий полный месяц' : difference === 0 ? 'Без изменений к предыдущему месяцу' : `${sign}${number(Math.abs(difference))} визитов${percent === null ? '' : ` (${sign}${number(Math.abs(percent))}%)`} к предыдущему месяцу`;
    const text=`<p class="traffic-value">${number(current.visits)}<span>визитов</span></p><p class="traffic-change ${trend}">${esc(change)}</p>${before ? `<p class="traffic-context">Предыдущий месяц: ${number(before.visits)} визитов.</p>` : ''}${!current.complete ? '<p class="traffic-context">Неполный месяц. Сравнение с полным месяцем не рассчитывается.</p>' : ''}${current.note ? `<p class="traffic-context">${esc(current.note)}</p>` : ''}`;
    return `<section class="traffic-card surface" aria-label="Переходы из поиска"><div><h3>Переходы из поиска</h3><p class="source-label">${esc(current.sourceLabel || 'Яндекс.Метрика · поисковые системы')}</p>${text}</div><div>${trafficChart()}</div></section>`;
  }
  function kpiHTML(engine,top) {
    const stats=view?.stats[engine], metric=stats?.['top'+top];
    if (!stats || !stats.total) return `<div class="engine-kpi-metric"><h4>Топ-${top}</h4><p class="no-metric">Нет данных</p></div>`;
    const after=metric.after/stats.total*100, before=metric.before === null ? null : metric.before/stats.total*100;
    const trend=before === null || after === before ? 'neutral' : after > before ? 'positive' : 'negative';
    return `<div class="engine-kpi-metric"><h4>Топ-${top}</h4><div class="kpi-values">${before === null ? '' : `<div><span class="kpi-period">Было</span><span class="number before">${number(metric.before)}</span></div>${icon('arrow','kpi-arrow')}`}<div>${before === null ? '' : '<span class="kpi-period">Стало</span>'}<span class="number ${trend}">${number(metric.after)}</span></div></div><p class="kpi-count">из ${number(stats.total)} запросов · ${number(after)}%</p></div>`;
  }
  function engineKpisHTML() {
    return `<div class="engine-kpi-grid">${['yandex','google'].map(engine=>`<section class="engine-kpi-card surface engine-${engine}" aria-labelledby="kpi-heading-${engine}"><h3 class="searcher-name" id="kpi-heading-${engine}">${engine==='yandex'?'Яндекс':'Google'}</h3><div class="engine-kpi-metrics">${[10,3].map(top=>kpiHTML(engine,top)).join('')}</div></section>`).join('')}</div>`;
  }
  function rankCharts() {
    if (!view) return '';
    const max=Math.max(1,...Object.values(view.stats).flatMap(stats => [stats.top3.before,stats.top3.after,stats.top10.before,stats.top10.after].filter(v => v !== null)));
    return `<div class="charts-grid">${['yandex','google'].map(engine => {
      const stats=view.stats[engine];
      if (!stats.total) return '';
      const bars=[3,10].map(top => {
        const pair=stats['top'+top];
        return `<div class="rank-bar-group">${['before','after'].map(side => pair[side] === null ? '' : `<div class="rank-bar ${side}" style="height:${pair[side]/max*104}px"><span>${number(pair[side])}</span></div>`).join('')}<strong>Топ-${top}</strong></div>`;
      }).join('');
      return `<section class="ranking-chart surface" aria-label="${engine === 'yandex' ? 'Яндекс' : 'Google'}: количество запросов"><h3>${engine === 'yandex' ? 'Яндекс' : 'Google'}</h3><div class="rank-bars">${bars}</div><div class="chart-legend">${stats.comparable ? `<span><i class="before-key"></i>Было · ${dateLabel(view.before.date)}</span>` : ''}<span><i></i>${stats.comparable ? 'Стало' : 'Сейчас'} · ${dateLabel(view.after.date)}</span></div></section>`;
    }).join('')}</div>`;
  }
  function competitorsHTML() {
    if (sites.length<2) return '';
    const cells=site=>['yandex','google'].map(engine=>[10,3].map(top=>{
      const stats=site.stats[engine], value=stats['top'+top], label=`${engine==='yandex'?'Яндекс':'Google'} · топ-${top}`;
      return `<td class="comparison-${engine} ${engine==='google'&&top===10?'searcher-divider':''}"><span class="comparison-label">${label}</span><span class="comparison-value">${value===null?'Нет данных':number(value)}</span>${value===null?'':`<span class="comparison-share">${number(value/stats.total*100)}%</span>`}</td>`;
    }).join('')).join('');
    return `<section class="competitors-card surface"><div class="section-heading"><h2>Сравнение с конкурентами</h2><p>Количество запросов в топе</p></div><table class="competitors-table"><caption class="sr-only">Показатели сайта и конкурентов по одному набору запросов</caption><thead><tr><th rowspan="2" scope="col">Сайт</th><th colspan="2" scope="colgroup" class="searcher-yandex">Яндекс</th><th colspan="2" scope="colgroup" class="searcher-google searcher-divider">Google</th></tr><tr><th scope="col" class="searcher-yandex-sub">Топ-10</th><th scope="col" class="searcher-yandex-sub">Топ-3</th><th scope="col" class="searcher-google-sub searcher-divider">Топ-10</th><th scope="col" class="searcher-google-sub">Топ-3</th></tr></thead><tbody>${sites.map(site=>`<tr class="${site.isProject?'is-project':''}"><th scope="row">${linkHTML({url:site.url,label:site.name})}</th>${cells(site)}</tr>`).join('')}</tbody></table></section>`;
  }
  function queryTableHTML() {
    if (!view) return '';
    const directions=[...new Set(view.rows.map(row => row.direction).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
    const initial=!view.before, compare=sites.length>1, columns=(initial?1:3)+(compare?1:0);
    const competitorFilter=compare?`<div class="filter-field competitor-filter"><label for="competitor-filter">Сравнить с сайтом</label><div class="select-wrap"><select id="competitor-filter">${sites.filter(s=>!s.isProject).map(s=>`<option value="${esc(s.id)}" ${state.competitor===s.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select>${icon('chevron')}</div></div>`:'';
    const headings=['yandex','google'].map(engine=>`${initial?`<th scope="col" class="engine-${engine} current"><span class="rank-label-long">${esc(data.project.name)}</span><span class="rank-label-short">Наш сайт</span><time>${dateLabel(view.after.date)}</time></th>`:`<th scope="col" class="engine-${engine}">Было<time>${dateLabel(view.before.date)}</time></th><th scope="col" class="engine-${engine} current">Стало<time>${dateLabel(view.after.date)}</time></th><th scope="col" class="engine-${engine}">Изменение</th>`}${compare?`<th scope="col" class="engine-${engine} competitor-rank"><span class="rank-label-long">Конкурент</span><span class="rank-label-short">Их сайт</span><time>${dateLabel(view.after.date)}</time></th>`:''}`).join('');
    const queryNoun=view.rows.length%100>=11&&view.rows.length%100<=14?'запросов':view.rows.length%10===1?'запрос':view.rows.length%10>=2&&view.rows.length%10<=4?'запроса':'запросов';
    return `<section class="queries-card surface"><div class="section-heading"><h2>Позиции запросов</h2><p>${number(view.rows.length)} ${queryNoun}</p></div><div class="table-filters"><div class="filter-field search"><label for="query-search">Найти запрос</label><input id="query-search" type="search" placeholder="Например, уборка квартиры" value="${esc(state.filters.search)}"></div><div class="filter-field"><label for="direction-filter">Направление</label><div class="select-wrap"><select id="direction-filter"><option value="">Все направления</option>${directions.map(d=>`<option value="${esc(d)}" ${d === state.filters.direction ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>${icon('chevron')}</div></div>${initial?'':`<div class="filter-field"><label for="trend-filter">Динамика в любом поисковике</label><div class="select-wrap"><select id="trend-filter">${[['all','Все изменения'],['up','Рост'],['down','Снижение'],['same','Без изменений'],['new','Новые запросы']].map(([value,label])=>`<option value="${value}" ${state.filters.trend === value ? 'selected' : ''}>${label}</option>`).join('')}</select>${icon('chevron')}</div></div>`}${competitorFilter}</div>
      <div class="mobile-engine" role="group" aria-label="Поисковик в таблице"><button type="button" data-engine="yandex" aria-pressed="${state.engine === 'yandex'}">Яндекс</button><button type="button" data-engine="google" aria-pressed="${state.engine === 'google'}">Google</button></div>
      ${initial?'':'<p class="table-scroll-hint">Таблицу можно листать вправо, чтобы увидеть все показатели.</p>'}<div class="table-scroll" id="positions-wrap" data-engine="${state.engine}" role="region" tabindex="0" aria-label="Позиции запросов"><table class="positions-table ${initial?'initial-positions':''} ${compare?'has-competitors':''}"><caption class="sr-only">${initial?'Позиции на '+esc(view.after.date):'Позиции на '+esc(view.before.date)+' и '+esc(view.after.date)}</caption><colgroup><col class="query-col">${['yandex','google'].map(engine=>`${initial?`<col class="rank-col engine-${engine}">`:`<col class="rank-col engine-${engine}"><col class="rank-col engine-${engine}"><col class="change-col engine-${engine}">`}${compare?`<col class="rank-col engine-${engine}">`:''}`).join('')}</colgroup><thead><tr><th rowspan="2" scope="col" class="query-heading">Запрос</th><th colspan="${columns}" scope="colgroup" class="engine-yandex engine-title">Яндекс</th><th colspan="${columns}" scope="colgroup" class="engine-google engine-title">Google</th></tr><tr>${headings}</tr></thead><tbody id="query-rows"></tbody></table></div><p id="query-empty" class="query-empty" hidden>Запросы не найдены. Измените поиск или фильтры.</p><div class="table-footer"><span id="query-count" role="status" aria-live="polite"></span><button type="button" class="button-secondary" id="show-more">Показать ещё 25</button></div><p class="table-method">101 — условное обозначение. Тип результата указан в подсказке.${initial?'':' Новые запросы не включаем в сравнение с прошлым замером.'}</p></section>`;
  }
  function rankCell(value,depth) {
    if (value === undefined) return '<span class="neutral" data-rank-state="missing" title="Замер отсутствует; 101 — условное обозначение, позиция неизвестна" aria-label="Замер отсутствует; 101 — условное обозначение, позиция неизвестна">101</span>';
    if (value === null) return '<span class="neutral" data-rank-state="not-found" title="Сайт не найден в проверенной выдаче; 101 — условное обозначение" aria-label="Сайт не найден в проверенной выдаче; 101 — условное обозначение">101</span>';
    return number(value);
  }
  function deltaHTML(change) {
    const labels={appeared:'Появился',lost:'За пределами',same:'Без изменений',no_data:'Не сравниваем',new:'Новый запрос'};
    if (change.kind === 'up' || change.kind === 'down') return `<span class="delta ${change.kind === 'up' ? 'positive' : 'negative'}" aria-label="${change.kind === 'up' ? 'Рост' : 'Снижение'} на ${change.amount}">${icon(change.kind)}${number(change.amount)}</span>`;
    return `<span class="delta ${change.kind === 'appeared' ? 'positive' : change.kind === 'lost' ? 'negative' : 'neutral'}">${labels[change.kind]}</span>`;
  }
  function renderQueries() {
    if (!view || !$('query-rows')) return;
    const filtered=M.filterRows(view.rows,state.filters), visible=filtered.slice(0,state.limit);
    const competitor=sites.find(site=>site.id===state.competitor);
    $('query-rows').innerHTML=visible.map(row=>`<tr><td>${esc(row.query)}${row.direction ? `<span class="query-direction">${esc([row.audience,row.direction].filter(Boolean).join(' · '))}</span>` : ''}</td>${['yandex','google'].map(engine=>`${view.before?`<td class="engine-${engine}">${rankCell(row[engine].before,view.before.depth)}</td>`:''}<td class="engine-${engine} current">${rankCell(row[engine].after,view.after.depth)}</td>${view.before?`<td class="engine-${engine}">${deltaHTML(row[engine].change)}</td>`:''}${competitor?`<td class="engine-${engine} competitor-rank">${rankCell(competitor.byId.get(row.id)?.[engine],competitor.snapshot.depth)}</td>`:''}`).join('')}</tr>`).join('');
    $('positions-wrap').hidden=filtered.length === 0;
    $('query-empty').hidden=filtered.length !== 0;
    $('query-count').textContent=`Показано: ${visible.length} из ${filtered.length}`;
    $('show-more').hidden=state.limit >= filtered.length;
  }
  function resetPerformanceFilters() {
    performanceState.filters={search:'',direction:'',trend:'all',cohort:'all'};
    performanceState.limit=25;
    gscSelectedDay=null;
  }
  function performanceKpisHTML() {
    return `<div class="engine-kpi-grid">${['yandex','google'].map(engine => {
      const stats=performanceView.stats[engine];
      const metrics=[10,3].map(top => {
        const pair=stats['top'+top], trend=pair.before===null || pair.before===pair.after ? 'neutral' : pair.after>pair.before ? 'positive' : 'negative';
        if (!stats.total) return `<div class="engine-kpi-metric"><h4>Топ-${top}</h4><p class="no-metric">Нет данных</p></div>`;
        return `<div class="engine-kpi-metric"><h4>Топ-${top}</h4><div class="kpi-values">${pair.before===null ? '' : `<div><span class="kpi-period">Было</span><span class="number before">${number(pair.before)}</span></div>${icon('arrow','kpi-arrow')}`}<div><span class="kpi-period">Стало</span><span class="number ${trend}">${number(pair.after)}</span></div></div><p class="kpi-count">из ${number(stats.total)} запросов · ${number(pair.after/stats.total*100)}%</p></div>`;
      }).join('');
      return `<section class="engine-kpi-card surface engine-${engine}" aria-labelledby="performance-kpi-${engine}"><h3 class="searcher-name" id="performance-kpi-${engine}">${engine==='yandex'?'Яндекс':'Google'}</h3><div class="engine-kpi-metrics">${metrics}</div></section>`;
    }).join('')}</div>`;
  }
  function performanceChartsHTML() {
    const max=Math.max(1,...Object.values(performanceView.stats).flatMap(stats => [stats.top3.before,stats.top3.after,stats.top10.before,stats.top10.after].filter(value => value!==null)));
    return `<div class="charts-grid">${['yandex','google'].map(engine => {
      const stats=performanceView.stats[engine];
      if (!stats.total) return '';
      const bars=[3,10].map(top => `<div class="rank-bar-group">${['before','after'].map(side => stats['top'+top][side]===null ? '' : `<div class="rank-bar ${side}" style="height:${stats['top'+top][side]/max*104}px"><span>${number(stats['top'+top][side])}</span></div>`).join('')}<strong>Топ-${top}</strong></div>`).join('');
      return `<section class="ranking-chart surface" aria-label="${engine==='yandex'?'Яндекс':'Google'}: было и стало"><h3>${engine==='yandex'?'Яндекс':'Google'}</h3><div class="rank-bars">${bars}</div><div class="chart-legend">${stats.comparable?'<span><i class="before-key"></i>Было</span>':''}<span><i></i>Стало</span></div></section>`;
    }).join('')}</div>`;
  }
  function performanceRankCell(value,depth) {
    if (value===undefined) return '<span class="performance-rank rank-missing" data-rank-state="missing" title="Замер отсутствует; 101 — условное обозначение, позиция неизвестна" aria-label="Замер отсутствует; 101 — условное обозначение, позиция неизвестна">101</span>';
    if (value===null) return '<span class="performance-rank rank-out" data-rank-state="not-found" title="Сайт не найден в проверенной выдаче; 101 — условное обозначение" aria-label="Сайт не найден в проверенной выдаче; 101 — условное обозначение">101</span>';
    const band=value<=3?'top3':value<=10?'top10':value<=30?'top30':'other';
    return `<span class="performance-rank rank-${band}" data-rank-state="measured">${number(value)}</span>`;
  }
  function performanceTableHTML() {
    const rows=performanceView.rows, directions=[...new Set(rows.map(row=>row.direction).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
    const cohorts=performanceReport.cohorts||[];
    const positionsExport=performanceReport.positionsExport, exportURL=M.safeHref(positionsExport?.url);
    const exportLink=exportURL?`<a class="performance-download" href="${esc(exportURL)}" download>${esc(positionsExport.label)}${icon('external')}</a>`:'';
    const headings=['yandex','google'].map(engine => ['before','after'].map(side => {
      const date=performanceView[side].date;
      return `<th id="performance-rank-${engine}-${side}" scope="col" class="engine-${engine} period-${side}"><time datetime="${esc(date)}" title="${esc(date)}">${dateLabel(date)}</time><span class="performance-rank-share"><span aria-hidden="true">1–10</span><span id="performance-share-${engine}-${side}"></span></span></th>`;
    }).join('')).join('');
    return `<section class="queries-card surface performance-queries"><div class="section-heading"><h2>Позиции запросов</h2>${exportLink}</div><div class="table-filters"><div class="filter-field search"><label for="performance-search">Найти запрос</label><input id="performance-search" type="search" placeholder="Например, уборка квартиры" value="${esc(performanceState.filters.search)}"></div>${cohorts.length?`<div class="filter-field cohort"><label for="performance-cohort">Выборка запросов</label><div class="select-wrap"><select id="performance-cohort"><option value="all">Все запросы</option>${cohorts.map(cohort=>`<option value="${esc(cohort.id)}" ${performanceState.filters.cohort===cohort.id?'selected':''}>${esc(cohort.label)}</option>`).join('')}</select>${icon('chevron')}</div></div>`:''}<div class="filter-field direction"><label for="performance-direction">Направление</label><div class="select-wrap"><select id="performance-direction"><option value="">Все направления</option>${directions.map(direction=>`<option value="${esc(direction)}" ${performanceState.filters.direction===direction?'selected':''}>${esc(direction)}</option>`).join('')}</select>${icon('chevron')}</div></div><div class="filter-field trend"><label for="performance-trend">Динамика</label><div class="select-wrap"><select id="performance-trend">${[['all','Все изменения'],['up','Рост'],['down','Снижение'],['same','Без изменений']].map(([value,label])=>`<option value="${value}" ${performanceState.filters.trend===value?'selected':''}>${label}</option>`).join('')}</select>${icon('chevron')}</div></div></div><div class="performance-rank-legend" aria-label="Обозначения текущих позиций"><span><i class="rank-top3" aria-hidden="true"></i>Топ-3</span><span><i class="rank-top10" aria-hidden="true"></i>4–10</span><span><i class="rank-top30" aria-hidden="true"></i>11–30</span><span><i class="rank-other" aria-hidden="true"></i>31–50</span></div><div class="mobile-engine" role="group" aria-label="Поисковик в таблице результатов"><button type="button" data-performance-engine="yandex" aria-pressed="${performanceState.engine==='yandex'}">Яндекс</button><button type="button" data-performance-engine="google" aria-pressed="${performanceState.engine==='google'}">Google</button></div><div class="table-scroll performance-table-scroll" id="performance-positions" data-engine="${performanceState.engine}" role="region" tabindex="0" aria-label="Позиции запросов: было и стало"><table class="positions-table performance-positions-table"><caption class="sr-only">Позиции на ${esc(performanceView.before.date)} и ${esc(performanceView.after.date)}</caption><colgroup><col class="query-col">${['yandex','google'].map(engine=>`<col class="rank-col engine-${engine}"><col class="rank-col engine-${engine}">`).join('')}</colgroup><thead><tr><th rowspan="2" scope="col" class="query-heading">Запрос</th><th id="performance-engine-yandex" colspan="2" scope="colgroup" class="engine-yandex engine-title">Яндекс</th><th id="performance-engine-google" colspan="2" scope="colgroup" class="engine-google engine-title">Google</th></tr><tr>${headings}</tr></thead><tbody id="performance-rows"></tbody></table></div><p id="performance-empty" class="query-empty" hidden>Запросы не найдены. Измените поиск или фильтры.</p><div class="table-footer"><span id="performance-count" role="status" aria-live="polite"></span><button type="button" class="button-secondary" id="performance-more">Показать ещё 25</button></div></section>`;
  }
  function renderPerformanceRows() {
    if (!performanceView || !$('performance-rows')) return;
    const filtered=M.filterPerformanceRows(performanceView.rows,performanceState.filters,performanceReport.cohorts), visible=filtered.slice(0,performanceState.limit);
    for (const engine of ['yandex','google']) for (const side of ['before','after']) {
      const share=M.performanceTopShare(filtered,engine,side), element=$(`performance-share-${engine}-${side}`);
      element.textContent=share.percent===null?'—':`${number(share.percent)}%`;
      element.setAttribute('aria-label',share.total?`${share.count} из ${share.total} запросов в топ-10`:'Нет замеров для расчёта');
    }
    $('performance-rows').innerHTML=visible.map((row,index)=>`<tr><th id="performance-query-${index}" scope="row" class="query-name">${esc(row.query)}</th>${['yandex','google'].map(engine=>['before','after'].map(side=>{
      const change=row[engine].change, movement=side==='after'&&['up','down','appeared','lost'].includes(change.kind)?`<span class="performance-movement">${deltaHTML(change)}</span>`:'';
      return `<td headers="performance-query-${index} performance-engine-${engine} performance-rank-${engine}-${side}" class="engine-${engine} period-${side}">${performanceRankCell(row[engine][side],performanceView[side].depth)}${movement}</td>`;
    }).join('')).join('')}</tr>`).join('');
    $('performance-positions').hidden=filtered.length===0;$('performance-empty').hidden=filtered.length!==0;
    $('performance-count').textContent=`Показано: ${visible.length} из ${filtered.length}`;
    $('performance-more').hidden=performanceState.limit>=filtered.length;
  }
  function gscDayLabel(item) {return dateLabel(item.date);}
  function gscCountLabel(value) {const count=Math.abs(value),last=count%10,teen=count%100;return `${number(value)} ${teen>=11&&teen<=14?'показов':last===1?'показ':last>=2&&last<=4?'показа':'показов'}`;}
  function gscDayDetail(item,beforeItem) {return `${beforeItem?`${gscDayLabel(beforeItem)}: ${gscCountLabel(beforeItem.impressions)}; `:''}${gscDayLabel(item)}: ${gscCountLabel(item.impressions)}`;}
  function searchConsoleHTML() {
    const gsc=M.searchConsoleView(performanceReport?.searchConsole);
    if (!gsc) return '';
    gscSelectedDay=gscSelectedDay===null?gsc.days.length-1:Math.min(Math.max(gscSelectedDay,0),gsc.days.length-1);
    const compared=!!gsc.beforeDays,beforeMonth=M.monthLabel(gsc.before.start.slice(0,7),false),afterMonth=M.monthLabel(gsc.after.start.slice(0,7),false);
    const maximum=Math.max(...gsc.days.map(day=>day.impressions),...(gsc.beforeDays||[]).map(day=>day.impressions)),rawStep=maximum/4;
    const magnitude=10**Math.floor(Math.log10(rawStep||1)),step=Math.max(1,Math.ceil(rawStep/magnitude)*magnitude),yMax=step*4;
    const plot=width=>{
      const mobile=width===320,left=mobile?38:48,right=width-14,top=28,bottom=206,dx=(right-left)/Math.max(gsc.days.length-1,1);
      const coordinates=gsc.days.map((day,index)=>({x:left+index*dx,y:bottom-day.impressions/yMax*(bottom-top)}));
      const beforeCoordinates=(gsc.beforeDays||[]).map((day,index)=>({x:left+index*dx,y:bottom-day.impressions/yMax*(bottom-top)}));
      const axes=Array.from({length:5},(_,index)=>{const value=index*step,y=bottom-value/yMax*(bottom-top);return `<line class="gsc-grid-line" x1="${left}" x2="${right}" y1="${y}" y2="${y}"/><text class="gsc-y-tick" x="${left-10}" y="${y+4}" text-anchor="end">${number(value)}</text>`;}).join('');
      const line=coordinates.map(point=>`${point.x},${point.y}`).join(' ');
      const beforeLine=compared?`<polyline class="gsc-line gsc-line-before" points="${beforeCoordinates.map(point=>`${point.x},${point.y}`).join(' ')}"/>${beforeCoordinates.map(point=>`<circle class="gsc-before-dot" cx="${point.x}" cy="${point.y}" r="3" aria-hidden="true"/>`).join('')}`:'';
      const points=gsc.days.map((day,index)=>{const point=coordinates[index],active=index===gscSelectedDay;return `<g class="gsc-point${active?' is-active':''}" data-gsc-day="${index}" role="button" tabindex="${active?0:-1}" aria-pressed="${active}" aria-label="${esc(gscDayDetail(day,gsc.beforeDays?.[index]))}" aria-describedby="gsc-day-detail"><circle class="gsc-point-target" cx="${point.x}" cy="${point.y}" r="14"/><circle class="gsc-point-dot" cx="${point.x}" cy="${point.y}" r="4.5"/><text class="gsc-point-value" x="${point.x}" y="${point.y-12}" text-anchor="${index===0?'start':index===gsc.days.length-1?'end':'middle'}">${number(day.impressions)}</text></g>`;}).join('');
      const labelIndexes=new Set(mobile?[0,Math.floor((gsc.days.length-1)/2),gsc.days.length-1]:[0,...gsc.days.map((item,index)=>Number(item.date.slice(-2))%5===0 && index<gsc.days.length-2?index:-1).filter(index=>index>=0),gsc.days.length-1]);
      const labels=gsc.days.map((day,index)=>!labelIndexes.has(index)?'':`<text class="gsc-x-tick" x="${coordinates[index].x}" y="237" text-anchor="${index===0?'start':index===gsc.days.length-1?'end':'middle'}">${esc(compared?day.date.slice(-2):gscDayLabel(day))}</text>`).join('');
      return `<svg class="gsc-chart-${mobile?'mobile':'desktop'}" viewBox="0 0 ${width} 254" role="group" aria-labelledby="gsc-chart-title-${width}" aria-describedby="gsc-chart-desc-${width}"><title id="gsc-chart-title-${width}">Показы сайта в Google по дням${compared?`: ${esc(beforeMonth)} и ${esc(afterMonth)}`:''}</title><desc id="gsc-chart-desc-${width}">${compared?'Линии сравниваются по одинаковым дням месяца.':'Показы за каждый день текущего периода.'} Выберите точку или день, чтобы увидеть ${compared?'оба значения':'его значение'}. Шкала начинается с нуля.</desc>${axes}${beforeLine}<polyline class="gsc-line" points="${line}"/>${points}${labels}</svg>`;
    };
    const resource=gsc.export,href=M.safeHref(resource?.url);
    const download=href?`<a class="performance-download" href="${esc(href)}" download>${esc(resource.label)}${icon('external')}</a>`:'';
    const trend=gsc.difference>0?'positive':gsc.difference<0?'negative':'neutral';
    const change=gsc.percent===null?`${gsc.difference>0?'+':''}${gscCountLabel(gsc.difference)}`:`${gsc.percent>0?'+':''}${number(gsc.percent)}%`;
    const periodTitle=side=>`${gsc[side].start} — ${gsc[side].end}`;
    const rows=gsc.days.map((day,index)=>`<tr><th scope="row">${esc(compared?day.date.slice(-2):gscDayLabel(day))}</th>${compared?`<td>${esc(gscDayLabel(gsc.beforeDays[index]))}</td><td>${number(gsc.beforeDays[index].impressions)}</td><td>${esc(gscDayLabel(day))}</td>`:''}<td>${number(day.impressions)}</td></tr>`).join('');
    const legend=compared?`<div class="gsc-legend" aria-label="Линии на графике"><span><i class="gsc-legend-before" aria-hidden="true"></i>${esc(beforeMonth)}</span><span><i class="gsc-legend-after" aria-hidden="true"></i>${esc(afterMonth)}</span></div>`:'';
    const pageExamples=gsc.pages?.length?`<div class="gsc-page-examples"><h3 id="gsc-page-examples-heading">Примеры роста показов</h3><table class="gsc-pages-table" aria-labelledby="gsc-page-examples-heading"><thead><tr><th scope="col">Страница</th>${['before','after'].map(side=>{const label=M.monthLabel(gsc[side].start.slice(0,7),false);return `<th scope="col" title="${esc(periodTitle(side))}" aria-label="${esc(label)}"><span class="gsc-month-long">${esc(label)}</span><span class="gsc-month-short" aria-hidden="true">${esc(label==='Сентябрь'?'Сент.':label.slice(0,3)+'.')}</span></th>`;}).join('')}</tr></thead><tbody>${gsc.pages.map(item=>`<tr><th scope="row"><a href="${esc(M.safeHref(item.url))}" target="_blank" rel="noopener noreferrer">${esc(item.label)}</a></th><td>${number(item.beforeImpressions)}</td><td>${number(item.afterImpressions)}</td></tr>`).join('')}</tbody></table></div>`:'';
    return `<section class="gsc-visibility surface" aria-labelledby="gsc-visibility-heading"><div class="section-heading"><h2 id="gsc-visibility-heading">Показы сайта в Google</h2><span class="gsc-source">${esc(gsc.sourceLabel)}</span></div><div class="gsc-comparison"><div><span class="gsc-period-label" title="${esc(periodTitle('before'))}">${M.monthLabel(gsc.before.start.slice(0,7),false)}</span><strong>${number(gsc.before.impressions)}</strong></div>${icon('arrow','gsc-comparison-arrow')}<div><span class="gsc-period-label" title="${esc(periodTitle('after'))}">${M.monthLabel(gsc.after.start.slice(0,7),false)}</span><strong class="${trend}">${number(gsc.after.impressions)}</strong></div><span class="gsc-change ${trend}">${change}</span></div><div class="gsc-chart-readout"><p class="gsc-day-detail" id="gsc-day-detail" role="status" aria-live="polite">${esc(gscDayDetail(gsc.days[gscSelectedDay],gsc.beforeDays?.[gscSelectedDay]))}</p><select id="gsc-day-select" aria-label="День на графике Google">${gsc.days.map((item,index)=>`<option value="${index}" ${index===gscSelectedDay?'selected':''}>${esc(gscDayLabel(item))}</option>`).join('')}</select></div>${legend}<div class="gsc-chart">${plot(1100)}${plot(320)}</div><div class="sr-only"><table><caption>Показы сайта в Google по дням</caption><thead><tr><th scope="col">${compared?'День месяца':'Период'}</th>${compared?`<th scope="col">Дата: ${esc(beforeMonth)}</th><th scope="col">Показы: ${esc(beforeMonth)}</th><th scope="col">Дата: ${esc(afterMonth)}</th>`:''}<th scope="col">Показы${compared?`: ${esc(afterMonth)}`:''}</th></tr></thead><tbody>${rows}</tbody></table></div>${pageExamples}${download}</section>`;
  }
  function selectGscDay(index) {
    const gsc=M.searchConsoleView(performanceReport?.searchConsole);
    if (!gsc) return false;
    if (!Number.isInteger(index) || index<0 || index>=gsc.days.length) return false;
    gscSelectedDay=index;
    $('gsc-day-detail').textContent=gscDayDetail(gsc.days[index],gsc.beforeDays?.[index]);
    $('gsc-day-select').value=String(index);
    document.querySelectorAll('[data-gsc-day]').forEach(node=>{
      const active=Number(node.dataset.gscDay)===index;
      node.setAttribute('aria-pressed',String(active));node.setAttribute('tabindex',active?'0':'-1');node.classList.toggle('is-active',active);
    });
    return true;
  }
  function showGscDay(event) {
    const point=event.target.closest?.('[data-gsc-day]');
    return point ? selectGscDay(Number(point.dataset.gscDay)) : false;
  }
  function monthlyResultsHTML(report) {
    performanceReport=report?.published ? report.performance||null : null;
    performanceView=M.performanceView(performanceReport);
    if (!performanceView) return pendingHTML('results');
    const intro=performanceReport.intro?paragraphsHTML(performanceReport.intro):'';
    return `<div class="monthly-performance"><div class="results-heading"><h2>Результаты за ${M.monthLabel(state.month).toLowerCase()}</h2>${intro}</div>${performanceKpisHTML()}${performanceChartsHTML()}${trafficHTML()}${searchConsoleHTML()}${performanceTableHTML()}</div>`;
  }
  function baselineHTML(report) {
    if (!report?.published) {view=null;sites=[];return pendingHTML('results');}
    view=M.rankingsView(report.rankings);
    sites=M.rankingSites(report.rankings,data.project);
    if (!sites.some(site=>!site.isProject&&site.id===state.competitor)) state.competitor=sites.find(site=>!site.isProject)?.id||'';
    const intro=report.kind!=='initial'&&report.intro?.length ? report.intro.map(p=>`<p>${esc(p)}</p>`).join('') : '';
    const mismatch=view?.before&&!view.metaMatch?'<p class="metrics-note">Настройки замеров различаются. Изменения позиций не сравниваем.</p>':'';
    return `<div class="results-heading"><h2>Стартовая аналитика</h2>${intro}</div>${engineKpisHTML()}${mismatch}${view?.before?rankCharts():''}${competitorsHTML()}${queryTableHTML()}`;
  }
  function worksHTML(report) {
    if (!report?.published) return pendingHTML('works');
    const works=report.works.filter(work=>work.status !== 'planned');
    if (!works.length) return '<div class="empty-state surface"><div class="empty-symbol">'+icon('work')+'</div><div><h2>Работы за этот месяц ещё не добавлены</h2><p>Подробности появятся после внесения подтверждённых результатов.</p><button type="button" class="button-primary" data-view="plan">Посмотреть план'+icon('arrow')+'</button></div></div>';
    return `<div class="works-heading"><h2>Работы за ${M.monthLabel(state.month).toLowerCase()}</h2><p>Что изменили, зачем и где посмотреть результат.</p></div><section class="surface"><table class="works-table"><thead><tr><th scope="col">Что сделали</th><th scope="col">Краткое описание</th><th scope="col">Для чего это нужно</th><th scope="col">Подробнее</th></tr></thead><tbody>${works.map(work=>`<tr><td><h3 class="work-name">${esc(work.title)}</h3></td><td class="work-summary">${esc(work.summary)}</td><td data-label="Для чего это нужно">${paragraphsHTML(work.why)}</td><td><button type="button" class="work-open" data-task="${esc(work.taskId)}" aria-label="Подробнее: ${esc(work.title)}">Подробнее${icon('arrow')}</button></td></tr>`).join('')}</tbody></table></section>`;
  }
  function section(title, content, isHTML=false) {
    return `<section class="detail-section"><h3>${esc(title)}</h3>${isHTML ? content : `<p>${esc(content)}</p>`}</section>`;
  }
  function evidenceHTML(item) {
    let body='';
    if (item.type === 'link') return `<ul class="detail-links"><li>${linkHTML(item)}</li></ul>`;
    if (item.type === 'comparison') body=`<div class="comparison-grid"><div><h4>Было</h4><p>${esc(item.before)}</p></div><div><h4>Стало</h4><p>${esc(item.after)}</p></div></div>`;
    if (item.type === 'table') body=`<div class="table-scroll" role="region" aria-label="${esc(item.label)}" tabindex="0"><table class="evidence-table"><thead><tr>${item.columns.map(cell=>`<th scope="col">${esc(cell)}</th>`).join('')}</tr></thead><tbody>${item.rows.map(row=>`<tr>${item.columns.map((_,i)=>`<td>${esc(row[i])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    return `<details class="evidence-block"><summary>${esc(item.label)}</summary><div class="evidence-content">${body}</div></details>`;
  }
  function actualHTML(work, reportOnly=false) {
    if (!work || work.status === 'planned') return '';
    const result=paragraphsHTML(work.result)+(work.resultBullets?.length ? `<ul class="result-bullets">${work.resultBullets.map(item=>`<li>${esc(item)}</li>`).join('')}</ul>` : '');
    let content=`<section class="actual-result"><h3>${reportOnly ? 'Что сделали' : 'Фактическое выполнение'}</h3>${reportOnly ? '' : `<p>${statusHTML(work.status)} · ${M.monthLabel(work.reportMonth)}</p>${workCountText(work)?`<p>${esc(workCountText(work))}</p>`:''}`}${result}${!reportOnly && work.reason ? `<p>${esc(work.reason)}</p>` : ''}${!reportOnly && work.scheduledMonth ? `<p>Следующий срок: ${M.monthLabel(work.scheduledMonth)}.</p>` : ''}`;
    content+=(work.sections || []).map(s=>section(s.title,`${paragraphsHTML(s.text)}${s.bullets?.length ? `<ul>${s.bullets.map(b=>`<li>${esc(b)}</li>`).join('')}</ul>` : ''}${s.links?.length ? `<ul class="detail-links">${s.links.map(l=>`<li>${linkHTML(l)}</li>`).join('')}</ul>` : ''}`,true)).join('');
    content+=(work.evidence || []).map(evidenceHTML).join('');
    return content+'</section>';
  }
  function renderDetail() {
    const record=taskIndex.get(state.detail), key=record ? `${state.detail}:${state.month}:${state.tab}` : null;
    if (!record) {
      if (dialog.open) {dialog.close();document.body.classList.remove('dialog-open');if(lastOpener?.isConnected) lastOpener.focus({preventScroll:true});else $('tab-'+state.tab).focus({preventScroll:true});}
      currentDetail=null;return;
    }
    if (currentDetail === key && dialog.open) return;
    const {task,stage}=record;
    const work=M.taskProgress(data,record.overview?M.tableTaskId(task.id,state.month):task.id,state.month);
    const isWorkReport=state.tab === 'works';
    dialog.dataset.reportView=isWorkReport ? 'works' : 'plan';
    $('detail-title').textContent=isWorkReport && work.title ? work.title : task.title;
    $('detail-meta').hidden=isWorkReport;
    $('detail-meta').textContent=isWorkReport ? '' : record.overview?`${M.monthLabel(data.project.periodStart)} — ${M.monthLabel(data.project.periodEnd).toLowerCase()}`:`В плане: ${M.monthLabel(stage.month)} · ${M.STATUS[work.status]}`;
    if (isWorkReport) {
      $('detail-body').innerHTML=actualHTML(work,true);
    } else if (record.matrixRow) {
      const row=record.matrixRow;
      $('detail-body').innerHTML=`<p class="detail-lead">${esc(row.purpose)}</p>${section('План работы по месяцам',`<dl class="matrix-schedule">${data.plan.table.months.map(month=>`<dt>${M.monthLabel(month)}</dt><dd>${row.schedule[month]===null?'—':row.schedule[month]==='●'?'Запланировано':typeof row.schedule[month]==='number'?`${number(row.schedule[month])} ${esc(row.unit)}`:esc(row.schedule[month])}</dd>`).join('')}</dl>`,true)}${actualHTML(work)}`;
    } else {
    const pages=task.pages?.length ? section('Приоритетные направления',`<ul class="detail-links">${task.pages.map(page=>`<li>${linkHTML(page)}</li>`).join('')}</ul><p style="margin-top:14px">Точный состав группы уточняем по очереди работ и результатам проверки адресов.</p>`,true) : '';
    const cycle=task.kind === 'content' ? section('Полный цикл работы со страницей',`<ol>${data.project.pageCycle.map(item=>`<li>${esc(item)}</li>`).join('')}</ol>`,true) : '';
    $('detail-body').innerHTML=`<p class="detail-lead">${esc(task.why)}</p>${task.target ? `<p class="detail-note">Планируем обновлять около ${task.target} страниц в месяц. Страницы выбираем перед началом работ по спросу и текущим задачам сайта.</p>` : ''}${section('Что входит в работу',`<ul>${task.actions.map(item=>`<li>${esc(item)}</li>`).join('')}</ul>`,true)}${cycle}${pages}${section('Ожидаемый результат',task.outcome)}${section('Что покажем в отчёте',task.proof)}${actualHTML(work)}`;
    }
    if (!dialog.open) {if(document.activeElement !== document.body) lastOpener=document.activeElement;dialog.showModal();document.body.classList.add('dialog-open');}
    $('detail-body').scrollTop=0;
    $('close-detail').focus({preventScroll:true});
    currentDetail=key;
  }
  function render() {
    const report=M.getReport(data,state.month);
    $('report-month').value=state.month;
    if (renderedMonth !== state.month) {
      $('panel-baseline').innerHTML=baselineHTML(baselineReport);
      $('panel-results').innerHTML=monthlyResultsHTML(report);
      $('panel-works').innerHTML=worksHTML(report);
      $('panel-plan').innerHTML=planHTML();
      renderedMonth=state.month;
    }
    for (const tab of tabs) {
      $('tab-'+tab).setAttribute('aria-selected',String(state.tab === tab));
      $('tab-'+tab).tabIndex=state.tab === tab ? 0 : -1;
      $('panel-'+tab).hidden=state.tab !== tab;
    }
    const count=report?.published ? report.works.filter(w=>w.status !== 'planned').length : 0;
    $('work-count').hidden=!count;$('work-count').textContent=count;
    document.title=`Отчёт по продвижению сайта «${data.project.name}» — ${M.monthLabel(state.month)}`;
    renderQueries();renderPerformanceRows();renderDetail();
  }
  $('report-client').textContent=`«${data.project.name}»`;
  $('site-link').href=M.safeHref(data.project.website);
  $('site-link').innerHTML=esc(new URL(data.project.website).hostname)+icon('external');
  $('period-label').textContent=`${M.monthLabel(data.project.periodStart)} — ${M.monthLabel(data.project.periodEnd).toLowerCase()}`;
  $('report-month').innerHTML=months.map(month=>`<option value="${month}">${M.monthLabel(month)}</option>`).join('');
  $('report-month').addEventListener('change',event=>{navigate({month:event.target.value,detail:null});$('announcement').textContent=`Выбран ${M.monthLabel(state.month)}.`;});
  tabs.forEach((tab,index)=>{
    $('tab-'+tab).addEventListener('click',()=>navigate({tab,detail:null}));
    $('tab-'+tab).addEventListener('keydown',event=>{
      if (event.ctrlKey || event.metaKey || event.altKey || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const next=event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length-1 : (index+(event.key === 'ArrowRight' ? 1 : -1)+tabs.length)%tabs.length;
      navigate({tab:tabs[next],detail:null},{focusTab:true});
    });
  });
  document.addEventListener('click',event=>{
    if (showGscDay(event)) return;
    const taskButton=event.target.closest('[data-task]');
    if(taskButton){lastOpener=taskButton;navigate({detail:taskButton.dataset.task});return;}
    const tabButton=event.target.closest('[data-view]');
    if(tabButton){navigate({tab:tabButton.dataset.view,detail:null},{focusTab:true});return;}
    const performanceEngine=event.target.closest('button[data-performance-engine]');
    if(performanceEngine){performanceState.engine=performanceEngine.dataset.performanceEngine;$('performance-positions').dataset.engine=performanceState.engine;document.querySelectorAll('button[data-performance-engine]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.performanceEngine===performanceState.engine)));return;}
    if(event.target.closest('#performance-more')){performanceState.limit+=25;renderPerformanceRows();return;}
    const engineButton=event.target.closest('button[data-engine]');
    if(engineButton){state.engine=engineButton.dataset.engine;$('positions-wrap').dataset.engine=state.engine;document.querySelectorAll('button[data-engine]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.engine === state.engine)));return;}
    if(event.target.closest('#show-more')){state.limit+=25;renderQueries();}
  });
  document.addEventListener('pointerover',showGscDay);
  document.addEventListener('focusin',showGscDay);
  document.addEventListener('keydown',event=>{
    const point=event.target.closest?.('[data-gsc-day]');
    if (!point || !['ArrowLeft','ArrowRight','Home','End','Enter',' '].includes(event.key)) return;
    event.preventDefault();
    if (event.key==='Enter' || event.key===' ') {showGscDay(event);return;}
    const points=Array.from(point.closest('svg').querySelectorAll('[data-gsc-day]')),index=points.indexOf(point);
    const next=event.key==='Home'?0:event.key==='End'?points.length-1:Math.min(points.length-1,Math.max(0,index+(event.key==='ArrowRight'?1:-1)));
    points[next].focus();
  });
  document.addEventListener('input',event=>{if(event.target.id === 'performance-search'){performanceState.filters.search=event.target.value;performanceState.limit=25;renderPerformanceRows();return;}if(event.target.id === 'query-search'){state.filters.search=event.target.value;state.limit=25;renderQueries();}});
  document.addEventListener('change',event=>{
    if (event.target.id==='gsc-day-select') {selectGscDay(Number(event.target.value));return;}
    const performanceFilter={'performance-direction':'direction','performance-trend':'trend','performance-cohort':'cohort'}[event.target.id];
    if(performanceFilter){performanceState.filters[performanceFilter]=event.target.value;performanceState.limit=25;renderPerformanceRows();return;}
    if(event.target.id === 'direction-filter') state.filters.direction=event.target.value;
    else if(event.target.id === 'trend-filter') state.filters.trend=event.target.value;
    else if(event.target.id === 'competitor-filter') state.competitor=event.target.value;
    else return;
    state.limit=25;renderQueries();
  });
  $('close-detail').addEventListener('click',()=>navigate({detail:null}));
  dialog.addEventListener('cancel',event=>{event.preventDefault();navigate({detail:null});});
  dialog.addEventListener('click',event=>{if(event.target === dialog){const r=dialog.getBoundingClientRect();if(event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) navigate({detail:null});}});
  function restoreRoute() {
    const next=readRoute();
    if(next.month!==state.month){state.filters={search:'',direction:'',trend:'all'};state.limit=25;resetPerformanceFilters();}
    Object.assign(state,next);render();
  }
  window.addEventListener('popstate',restoreRoute);
  window.addEventListener('hashchange',()=>{if(tabs.includes(location.hash.slice(1))) restoreRoute();});
  Object.assign(state,readRoute());
  navigate({}, {replace:true});
})();
