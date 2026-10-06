(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.ReportModel = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const STATUS = {planned:'Запланировано',in_progress:'В работе',done:'Выполнено',moved:'Перенесено'};
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const monthLabel = (month, year = true) => `${MONTHS[Number(month.slice(5)) - 1]}${year ? ' ' + month.slice(0,4) : ''}`;
  const previousMonth = month => {
    const [year, number] = month.split('-').map(Number);
    return number === 1 ? `${year - 1}-12` : `${year}-${String(number - 1).padStart(2,'0')}`;
  };
  const monthRange = (start, end) => {
    const result = [];
    for (let cursor = start; cursor <= end && result.length < 120;) {
      result.push(cursor);
      const [year, month] = cursor.split('-').map(Number);
      cursor = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2,'0')}`;
    }
    return result;
  };
  function safeHref(value) {
    if (typeof value !== 'string') return null;
    if (/^evidence\/[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(value) && !value.split('/').includes('..')) return value;
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
    } catch (_) { /* Invalid links are rendered as text. */ }
    return null;
  }
  function defaultMonth(data) {
    const published = data.reports.filter(r => r.published && r.month >= data.project.periodStart && r.month <= data.project.periodEnd);
    return published.map(r => r.month).sort().at(-1) || data.project.periodStart;
  }
  const getReport = (data, month) => data.reports.find(r => r.month === month) || null;
  function trafficComparison(data, month) {
    const report = getReport(data, month);
    const current = report?.published ? report.traffic : null;
    const prior = getReport(data, previousMonth(month));
    const before = prior?.published || prior?.baseline ? prior.traffic : null;
    const comparable = !!(current && before && current.complete && before.complete &&
      current.sourceKey === before.sourceKey && current.filterKey === before.filterKey);
    return {current, before: comparable ? before : null, comparable,
      difference: comparable ? current.visits - before.visits : null,
      percent: comparable && before.visits !== 0 ? (current.visits - before.visits) / before.visits * 100 : null};
  }
  function trafficHistory(data, month) {
    const report = getReport(data, month);
    const current = report?.published ? report.traffic : null;
    return monthRange(data.project.baselineMonth || data.project.periodStart, month).map(key => {
      const r = getReport(data, key);
      const t = r?.published || r?.baseline ? r.traffic : null;
      const same = t && current && t.sourceKey === current.sourceKey && t.filterKey === current.filterKey;
      return {month:key, visits:same && t.complete ? t.visits : null};
    });
  }
  function rankChange(before, after, comparable = true, isNew = false) {
    if (!comparable || after === undefined) return {kind:'no_data', amount:null};
    if (isNew || before === undefined) return {kind:'new', amount:null};
    if (before === null && after === null) return {kind:'same', amount:0};
    if (before === null) return {kind:'appeared', amount:null};
    if (after === null) return {kind:'lost', amount:null};
    return {kind:before > after ? 'up' : before < after ? 'down' : 'same', amount:Math.abs(before - after)};
  }
  function rankingsView(rankings) {
    if (!rankings?.after) return null;
    const {before, after} = rankings;
    const metaMatch = !!before && before.region === after.region && before.device === after.device;
    const beforeMap = new Map((before?.rows || []).map(row => [row.id,row]));
    const afterMap = new Map(after.rows.map(row => [row.id,row]));
    const ids = [...new Set([...afterMap.keys(), ...beforeMap.keys()])];
    const rows = ids.map(id => {
      const old = beforeMap.get(id), current = afterMap.get(id), display = current || old;
      const row = {id, query:display.query, direction:display.direction, audience:display.audience, isNew:!!before && !old, removed:!current};
      for (const engine of ['yandex','google']) {
        row[engine] = {before:old?.[engine],after:current?.[engine],
          change:rankChange(old?.[engine],current?.[engine],metaMatch,!!before && !old)};
      }
      return row;
    });
    const stats = {};
    for (const engine of ['yandex','google']) {
      const comparableRows = rows.filter(r => r[engine].before !== undefined && r[engine].after !== undefined);
      const currentRows = rows.filter(r => r[engine].after !== undefined);
      const matched = metaMatch && comparableRows.length > 0;
      const population = matched ? comparableRows : currentRows;
      const count = (side, top) => population.filter(r => typeof r[engine][side] === 'number' && r[engine][side] <= top).length;
      stats[engine] = {comparable:matched,total:population.length,currentTotal:currentRows.length,
        newCount:rows.filter(r => r.isNew && r[engine].after !== undefined).length,
        missingCount:rows.filter(r => r[engine].before !== undefined && r[engine].after === undefined).length,
        top3:{before:matched ? count('before',3) : null,after:count('after',3)},
        top10:{before:matched ? count('before',10) : null,after:count('after',10)}};
    }
    return {rows,stats,before,after,metaMatch};
  }
  function rankingSites(rankings, project) {
    const after=rankings?.after;
    if (!after) return [];
    const sites=[{id:'project',name:project.name,url:project.website,snapshot:after,isProject:true},...(rankings.competitors||[])];
    return sites.map(site=>{
      const snapshot=site.snapshot;
      const comparable=snapshot && snapshot.date===after.date && snapshot.region===after.region && snapshot.device===after.device;
      const byId=new Map((snapshot?.rows||[]).map(row=>[row.id,row]));
      const stats={};
      for (const engine of ['yandex','google']) {
        const measured=comparable ? after.rows.map(row=>byId.get(row.id)?.[engine]).filter(value=>value!==undefined) : [];
        stats[engine]={total:measured.length,top3:measured.length ? measured.filter(v=>typeof v==='number'&&v<=3).length : null,
          top10:measured.length ? measured.filter(v=>typeof v==='number'&&v<=10).length : null};
      }
      return {...site,stats,comparable,byId};
    });
  }
  function filterRows(rows, {search='',direction='',trend='all'} = {}) {
    const normalize = text => String(text).toLocaleLowerCase('ru-RU').replaceAll('ё','е').trim();
    return rows.filter(row => {
      if (search && !normalize(row.query).includes(normalize(search))) return false;
      if (direction && row.direction !== direction) return false;
      const kinds = [row.yandex.change.kind,row.google.change.kind];
      if (trend === 'up') return kinds.some(k => ['up','appeared'].includes(k));
      if (trend === 'down') return kinds.some(k => ['down','lost'].includes(k));
      if (trend === 'same') return kinds.includes('same') && kinds.every(k => ['same','no_data'].includes(k));
      if (trend === 'new') return row.isNew;
      return true;
    });
  }
  function taskProgress(data, taskId, asOf) {
    let found = null;
    for (const report of [...data.reports].sort((a,b) => a.month.localeCompare(b.month))) {
      if (report.month > asOf) continue;
      for (const work of report.works || []) if (work.taskId === taskId) found = {...work, reportMonth:report.month};
    }
    return found || {status:'planned',taskId};
  }
  function stageStatus(data, stage, asOf) {
    const statuses = stage.tasks.map(task => taskProgress(data, task.id, asOf).status);
    if (statuses.every(s => s === 'done')) return 'done';
    if (statuses.every(s => s === 'moved')) return 'moved';
    if (statuses.some(s => s === 'in_progress' || s === 'done')) return 'in_progress';
    if (statuses.some(s => s === 'moved')) return 'in_progress';
    return 'planned';
  }
  function incomingTasks(data, month, asOf) {
    return data.plan.months.flatMap(stage => stage.tasks.map(task => ({task,originalMonth:stage.month,
      progress:taskProgress(data,task.id,asOf)}))).filter(item => item.originalMonth !== month &&
        item.progress.scheduledMonth === month && item.progress.status === 'moved');
  }
  const tableTaskId = (rowId, month) => `${rowId}@${month}`;
  function planTaskEntries(data) {
    const entries=data.plan.months.flatMap(stage=>stage.tasks.map(task=>({task,stage})));
    const table=data.plan.table;
    if (table) for (const group of table.groups) for (const row of group.rows) {
      for (const month of table.months) if (row.schedule[month] !== null) {
        const phase=row.schedule[month];
        entries.push({task:{id:tableTaskId(row.id,month),title:row.title,summary:row.purpose,why:row.purpose,
          target:typeof phase==='number'?phase:undefined,unit:row.unit},stage:{month},matrixRow:row});
      }
    }
    return entries;
  }
  function validateData(data) {
    const errors = [], check = (condition, message) => { if (!condition) errors.push(message); };
    const validMonth = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(value || '');
    const {project,plan,reports} = data;
    if (!project || !plan || !Array.isArray(reports)) return ['Нужны project, plan и reports.'];
    check(typeof project.id === 'string' && project.id.length > 0,'Не задан идентификатор проекта.');
    check(safeHref(project.website)?.startsWith('https:'),'Некорректный адрес сайта проекта.');
    check(validMonth(project.periodStart) && validMonth(project.periodEnd) && project.periodStart <= project.periodEnd,'Некорректный период проекта.');
    check(plan.projectId === project.id,'План относится к другому клиенту.');
    check(Array.isArray(plan.months),'В плане нет месяцев.');
    if (!Array.isArray(plan.months)) return errors;
    check(JSON.stringify(plan.months.map(m => m.month)) === JSON.stringify(monthRange(project.periodStart, project.periodEnd)),'Месяцы плана должны идти подряд в пределах периода.');
    const taskIds = new Set();
    for (const stage of plan.months) for (const task of stage.tasks || []) {
      check(typeof task.id === 'string' && !taskIds.has(task.id),`Повторный или пустой id задачи: ${task.id}`);
      taskIds.add(task.id);
      check(!!task.title && !!task.why && !!task.outcome,`Не заполнено описание задачи ${task.id}.`);
      for (const page of task.pages || []) check(!!safeHref(page.url),`Некорректная ссылка в задаче ${task.id}.`);
    }
    if (plan.table) {
      const table=plan.table, tableMonths=monthRange(project.periodStart,project.periodEnd), groupIds=new Set(), rowIds=new Set();
      check(table.projectId===project.id,'Таблица плана относится к другому клиенту.');
      check(JSON.stringify(table.months)===JSON.stringify(tableMonths),'Месяцы таблицы не совпадают с периодом проекта.');
      check(Array.isArray(table.intro) && table.intro.length>0 && table.intro.every(p=>typeof p==='string' && p.trim()),'Не заполнен текст над таблицей.');
      check(Array.isArray(table.groups) && table.groups.length>0,'В таблице нет разделов.');
      for (const group of Array.isArray(table.groups)?table.groups:[]) {
        check(!!group.id && !groupIds.has(group.id) && !!group.title,'Повторный или незаполненный раздел таблицы.');groupIds.add(group.id);
        check(Array.isArray(group.rows) && group.rows.length>0,`Нет работ в разделе ${group.id}.`);
        for (const row of Array.isArray(group.rows)?group.rows:[]) {
          check(!!row.id && !rowIds.has(row.id) && !taskIds.has(row.id),`Повторный идентификатор строки ${row.id}.`);rowIds.add(row.id);
          check(!!row.title && !!row.purpose,`Не заполнена работа или цель ${row.id}.`);
          const schedule=row.schedule;
          check(schedule && typeof schedule==='object' && !Array.isArray(schedule),`Нет расписания ${row.id}.`);
          if (!schedule || typeof schedule!=='object' || Array.isArray(schedule)) continue;
          check(JSON.stringify(Object.keys(schedule).sort())===JSON.stringify([...tableMonths].sort()),`Неполное расписание ${row.id}.`);
          for (const month of tableMonths) {
            const phase=schedule[month];
            check(phase===null || (typeof phase==='string' && phase.trim().length>0) || (Number.isInteger(phase) && phase>=0),`Неверная ячейка ${row.id}/${month}.`);
            if (phase!==null && phase!==undefined) taskIds.add(tableTaskId(row.id,month));
          }
          if (Object.values(schedule).some(phase=>typeof phase==='number')) check(typeof row.unit==='string' && !!row.unit.trim(),`Не задана единица объёма ${row.id}.`);
        }
      }
    }
    const months = new Set();
    for (const report of reports) {
      const context = `Месяц ${report.month}`;
      check(report.projectId === project.id,`${context}: данные другого клиента.`);
      check(validMonth(report.month) && !months.has(report.month),`${context}: повторный или некорректный месяц.`);
      months.add(report.month);
      check(report.month === project.baselineMonth || (report.month >= project.periodStart && report.month <= project.periodEnd),`${context}: вне периода проекта.`);
      check(typeof report.published === 'boolean',`${context}: published должен быть true или false.`);
      if (report.kind!==undefined) check(['initial','monthly'].includes(report.kind),`${context}: неизвестный вид отчёта.`);
      if (report.baseline) check(report.month === project.baselineMonth && !report.published,`${context}: некорректная базовая выгрузка.`);
      if (report.traffic) {
        const t = report.traffic;
        check(Number.isInteger(t.visits) && t.visits >= 0,`${context}: визиты должны быть целым неотрицательным числом.`);
        check(typeof t.complete === 'boolean' && !!t.sourceKey && !!t.filterKey,`${context}: не заданы параметры трафика.`);
      }
      const rankingSnapshots=Object.entries(report.rankings||{}).filter(([side])=>side!=='competitors');
      const competitors=report.rankings?.competitors;
      if (competitors!==undefined) check(Array.isArray(competitors),`${context}: конкуренты должны быть массивом.`);
      const competitorIds=new Set();
      const mainRows=new Map((report.rankings?.after?.rows||[]).map(row=>[row.id,row.query]));
      for (const competitor of Array.isArray(competitors)?competitors:[]) {
        check(typeof competitor.id==='string' && !!competitor.id && !competitorIds.has(competitor.id),`${context}: пустой или повторный id конкурента.`);competitorIds.add(competitor.id);
        check(!!competitor.name && !!safeHref(competitor.url),`${context}: не заполнено имя или ссылка конкурента.`);
        check(!!competitor.snapshot,`${context}: нет среза конкурента.`);
        if (competitor.snapshot) {
          const main=report.rankings?.after;
          check(main && ['date','region','device'].every(key=>main[key]===competitor.snapshot[key]),`${context}: замер конкурента должен совпадать по дате, региону и устройству.`);
          for (const row of competitor.snapshot.rows||[]) check(mainRows.get(row.id)===row.query,`${context}: запрос конкурента ${row.id} отсутствует в общем наборе.`);
          rankingSnapshots.push(['competitor:'+competitor.id,competitor.snapshot]);
        }
      }
      for (const [side,snapshot] of rankingSnapshots) {
        if (!snapshot) continue;
        check(['before','after'].includes(side)||side.startsWith('competitor:'),`${context}: неизвестный замер ${side}.`);
        check(/^\d{4}-\d{2}-\d{2}$/.test(snapshot.date || '') && !!snapshot.region && !!snapshot.device,`${context}: не заданы дата, регион или устройство.`);
        check(Number.isInteger(snapshot.depth) && snapshot.depth >= 10,`${context}: глубина проверки должна быть не меньше 10.`);
        check(Array.isArray(snapshot.rows),`${context}: нет строк позиций.`);
        const ids = new Set();
        for (const row of snapshot.rows || []) {
          check(!!row.id && !ids.has(row.id) && !!row.query,`${context}: пустой или повторный id запроса.`);
          ids.add(row.id);
          for (const engine of ['yandex','google']) if (own(row,engine)) check(row[engine] === null ||
            (Number.isInteger(row[engine]) && row[engine] >= 1 && row[engine] <= snapshot.depth),`${context}: неверная позиция ${row.id}/${engine}.`);
        }
      }
      if (report.rankings?.before && report.rankings?.after) {
        check(report.rankings.before.date < report.rankings.after.date,`${context}: начальный замер должен предшествовать итоговому.`);
        const original = new Map((report.rankings.before.rows || []).map(row => [row.id,row.query]));
        for (const row of report.rankings.after.rows || []) if (original.has(row.id)) check(original.get(row.id) === row.query,`${context}: текст запроса ${row.id} изменился при сохранении id.`);
      }
      const workIds = new Set(), monthTasks = new Set();
      for (const work of report.works || []) {
        check(!!work.id && !workIds.has(work.id),`${context}: повторный id работы.`); workIds.add(work.id);
        check(taskIds.has(work.taskId) && !monthTasks.has(work.taskId),`${context}: неизвестная или повторная taskId ${work.taskId}.`); monthTasks.add(work.taskId);
        check(own(STATUS,work.status),`${context}: неизвестный статус работы.`);
        check(!!work.title && !!work.summary && !!work.why,`${context}: не заполнено описание работы ${work.id}.`);
        if (work.resultBullets !== undefined) check(Array.isArray(work.resultBullets) && work.resultBullets.every(item => typeof item === 'string' && !!item.trim()),`${context}: resultBullets работы ${work.id} должен быть массивом непустых строк.`);
        if (work.status === 'done') check(!!work.result && !!work.evidence?.length,`${context}: выполненная работа ${work.id} требует результата и подтверждения.`);
        if (work.status === 'moved') check(!!work.reason && validMonth(work.scheduledMonth) && work.scheduledMonth > report.month && work.scheduledMonth <= project.periodEnd,`${context}: перенос требует причины и следующего месяца в пределах плана.`);
        if (work.completedCount !== undefined) check(Number.isInteger(work.completedCount) && work.completedCount >= 0,`${context}: некорректный фактический объём.`);
        if (work.targetCount !== undefined) check(Number.isInteger(work.targetCount) && work.targetCount > 0,`${context}: некорректный плановый объём.`);
        if (work.status === 'done' && work.completedCount !== undefined && work.targetCount !== undefined && work.completedCount < work.targetCount) check(!!work.reason,`${context}: уменьшение выполненного объёма требует пояснения.`);
        for (const evidence of work.evidence || []) {
          check(['link','comparison','table'].includes(evidence.type) && !!evidence.label,`${context}: некорректное подтверждение.`);
          if (evidence.type === 'link') check(!!safeHref(evidence.url),`${context}: небезопасная ссылка подтверждения.`);
          if (evidence.type === 'comparison') check(!!evidence.before && !!evidence.after,`${context}: не заполнено сравнение.`);
          if (evidence.type === 'table') check(Array.isArray(evidence.columns) && evidence.columns.length > 0 && Array.isArray(evidence.rows) && evidence.rows.length > 0,`${context}: пустая таблица подтверждений.`);
        }
      }
    }
    for (const month of monthRange(project.periodStart,project.periodEnd)) check(months.has(month),`Отсутствует файл месяца ${month}.`);
    return errors;
  }
  return {MONTHS,STATUS,monthLabel,previousMonth,monthRange,safeHref,defaultMonth,getReport,trafficComparison,trafficHistory,
    rankChange,rankingsView,rankingSites,filterRows,taskProgress,stageStatus,incomingTasks,tableTaskId,planTaskEntries,validateData};
});
