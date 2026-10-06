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
  const tabs = ['plan','results','works'];
  const months = data.plan.months.map(stage => stage.month);
  const taskIndex = new Map(M.planTaskEntries(data).map(entry=>[entry.task.id,entry]));
  if (data.plan.table) for (const group of data.plan.table.groups) for (const row of group.rows) {
    taskIndex.set(row.id,{task:{id:row.id,title:row.title,summary:row.purpose,why:row.purpose},matrixRow:row,overview:true});
  }
  const state = {month:M.defaultMonth(data),tab:'plan',detail:null,filters:{search:'',direction:'',trend:'all'},limit:25,engine:'yandex',competitor:''};
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
    if (changedMonth) {state.filters={search:'',direction:'',trend:'all'};state.limit=25;}
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
      ${initial?'':'<p class="table-scroll-hint">Таблицу можно листать вправо, чтобы увидеть все показатели.</p>'}<div class="table-scroll" id="positions-wrap" data-engine="${state.engine}" role="region" tabindex="0" aria-label="Позиции запросов"><table class="positions-table ${initial?'initial-positions':''} ${compare?'has-competitors':''}"><caption class="sr-only">${initial?'Позиции на '+esc(view.after.date):'Позиции на '+esc(view.before.date)+' и '+esc(view.after.date)}</caption><colgroup><col class="query-col">${['yandex','google'].map(engine=>`${initial?`<col class="rank-col engine-${engine}">`:`<col class="rank-col engine-${engine}"><col class="rank-col engine-${engine}"><col class="change-col engine-${engine}">`}${compare?`<col class="rank-col engine-${engine}">`:''}`).join('')}</colgroup><thead><tr><th rowspan="2" scope="col" class="query-heading">Запрос</th><th colspan="${columns}" scope="colgroup" class="engine-yandex engine-title">Яндекс</th><th colspan="${columns}" scope="colgroup" class="engine-google engine-title">Google</th></tr><tr>${headings}</tr></thead><tbody id="query-rows"></tbody></table></div><p id="query-empty" class="query-empty" hidden>Запросы не найдены. Измените поиск или фильтры.</p><div class="table-footer"><span id="query-count" role="status" aria-live="polite"></span><button type="button" class="button-secondary" id="show-more">Показать ещё 25</button></div><p class="table-method">«—» — сайт не найден в результатах проверки. «Нет замера» — измерение отсутствует.${initial?'':' Новые запросы не включаем в сравнение с прошлым замером.'}</p></section>`;
  }
  function rankCell(value,depth) {
    if (value === undefined) return '<span class="neutral">Нет замера</span>';
    if (value === null) return '<span class="neutral" title="Не найден в результатах проверки">—<span class="sr-only">Не найден в результатах проверки</span></span>';
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
  function resultsHTML(report) {
    if (!report?.published) {view=null;sites=[];return pendingHTML('results');}
    view=M.rankingsView(report.rankings);
    sites=M.rankingSites(report.rankings,data.project);
    if (!sites.some(site=>!site.isProject&&site.id===state.competitor)) state.competitor=sites.find(site=>!site.isProject)?.id||'';
    const intro=report.kind!=='initial'&&report.intro?.length ? report.intro.map(p=>`<p>${esc(p)}</p>`).join('') : '';
    const mismatch=view?.before&&!view.metaMatch?'<p class="metrics-note">Настройки замеров различаются. Изменения позиций не сравниваем.</p>':'';
    return `<div class="results-heading"><h2>${report.kind==='initial'?'Начальные показатели':'Результаты за '+M.monthLabel(state.month).toLowerCase()}</h2>${intro}</div>${engineKpisHTML()}${mismatch}${view?.before?rankCharts():''}${competitorsHTML()}${trafficHTML()}${queryTableHTML()}`;
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
      $('panel-results').innerHTML=resultsHTML(report);
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
    renderQueries();renderDetail();
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
    const taskButton=event.target.closest('[data-task]');
    if(taskButton){lastOpener=taskButton;navigate({detail:taskButton.dataset.task});return;}
    const tabButton=event.target.closest('[data-view]');
    if(tabButton){navigate({tab:tabButton.dataset.view,detail:null},{focusTab:true});return;}
    const engineButton=event.target.closest('button[data-engine]');
    if(engineButton){state.engine=engineButton.dataset.engine;$('positions-wrap').dataset.engine=state.engine;document.querySelectorAll('button[data-engine]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.engine === state.engine)));return;}
    if(event.target.closest('#show-more')){state.limit+=25;renderQueries();}
  });
  document.addEventListener('input',event=>{if(event.target.id === 'query-search'){state.filters.search=event.target.value;state.limit=25;renderQueries();}});
  document.addEventListener('change',event=>{
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
    if(next.month!==state.month){state.filters={search:'',direction:'',trend:'all'};state.limit=25;}
    Object.assign(state,next);render();
  }
  window.addEventListener('popstate',restoreRoute);
  window.addEventListener('hashchange',()=>{if(tabs.includes(location.hash.slice(1))) restoreRoute();});
  Object.assign(state,readRoute());
  navigate({}, {replace:true});
})();
