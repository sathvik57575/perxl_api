(function () {
  var $ = function (id) { return document.getElementById(id); };
  var form = $('score-form');
  var DAY = 86400000;

  // datetime-local wants "YYYY-MM-DDTHH:mm" in local time
  function localValue(date) {
    var d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  }
  function inDays(n) { return localValue(new Date(Date.now() + n * DAY)); }

  $('dueDate').value = inDays(10);

  $('assignee').addEventListener('change', function () {
    $('manual').hidden = this.value !== 'manual';
  });

  var presets = {
    risky: { days: 2, assignee: 'manual', n: 50, late: 40 },
    safe: { days: 30, assignee: 'manual', n: 50, late: 15 },
    unknown: { days: 10, assignee: 'unknown' },
  };
  document.querySelectorAll('[data-preset]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var p = presets[btn.getAttribute('data-preset')];
      $('dueDate').value = inDays(p.days);
      $('createdOn').value = '';
      $('assignee').value = p.assignee;
      $('manual').hidden = p.assignee !== 'manual';
      if (p.assignee === 'manual') { $('histN').value = p.n; $('histLate').value = p.late; }
      form.requestSubmit();
    });
  });

  function showError(message) {
    var box = $('error');
    box.textContent = message;
    box.hidden = false;
    $('result').hidden = true;
  }

  function el(tag, text, className) {
    var e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (className) e.className = className;
    return e;
  }

  function render(r) {
    $('error').hidden = true;
    var pct = Math.round(r.probability * 100);
    $('prob').textContent = pct + '%';
    $('bar-fill').style.width = pct + '%';
    var level = $('level');
    level.textContent = r.riskLevel === 'higher' ? 'Higher risk' : 'Lower risk';
    level.className = 'badge ' + r.riskLevel;

    var factors = $('factors'); factors.replaceChildren();
    r.factors.forEach(function (f) {
      var li = el('li', f.description + ' ');
      li.appendChild(el('span', '(' + f.effect + ')', 'effect'));
      factors.appendChild(li);
    });

    var warnings = $('warnings'); warnings.replaceChildren();
    r.warnings.forEach(function (w) { warnings.appendChild(el('div', w)); });
    warnings.hidden = r.warnings.length === 0;

    var inputs = $('inputs'); inputs.replaceChildren();
    [
      ['Lead time', r.inputsUsed.leadDays + ' days'],
      ['Assignee late rate', Math.round(r.inputsUsed.assigneeLateRate * 100) + '%'],
      ['Assignee history', r.inputsUsed.assigneeHistoryTasks + ' tasks (' + r.inputsUsed.historySource + ')'],
    ].forEach(function (row) { inputs.appendChild(el('dt', row[0])); inputs.appendChild(el('dd', row[1])); });

    $('result').hidden = false;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!$('dueDate').value) return showError('Please choose a due date.');
    var body = {
      dueDate: new Date($('dueDate').value).toISOString(),
      createdOn: $('createdOn').value ? new Date($('createdOn').value).toISOString() : '',
      assigneeRef: $('assignee').value,
    };
    if (body.assigneeRef === 'manual') {
      body.history = { n: Number($('histN').value), late: Number($('histLate').value) };
    }
    fetch('/ui/score', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
      .then(function (r) {
        if (!r.ok) {
          var d = r.data.error || {};
          var detail = (d.details || []).map(function (x) { return x.field + ' ' + x.message; }).join('; ');
          return showError((d.message || 'Request failed') + (detail ? ': ' + detail : ''));
        }
        render(r.data);
      })
      .catch(function () { showError('Could not reach the server.'); });
  });

  function setTab(mode) {
    var single = mode === 'single';
    $('single-tab').classList.toggle('active', single);
    $('single-tab').setAttribute('aria-selected', String(single));
    $('single-panel').hidden = !single;
    $('batch-tab').classList.toggle('active', !single);
    $('batch-tab').setAttribute('aria-selected', String(!single));
    $('batch-panel').hidden = single;
  }
  $('single-tab').addEventListener('click', function () { setTab('single'); });
  $('batch-tab').addEventListener('click', function () { setTab('batch'); });

  function parseCsv(text) {
    var records = [];
    var row = [];
    var field = '';
    var quoted = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') quoted = false;
        else field += ch;
      } else if (ch === '"' && field.length === 0) {
        quoted = true;
      } else if (ch === ',') {
        row.push(field); field = '';
      } else if (ch === '\n' || ch === '\r') {
        row.push(field); field = '';
        if (row.some(function (value) { return value.trim() !== ''; })) records.push(row);
        row = [];
        if (ch === '\r' && text[i + 1] === '\n') i++;
      } else {
        field += ch;
      }
    }
    if (quoted) throw new Error('CSV contains an unclosed quoted field.');
    row.push(field);
    if (row.some(function (value) { return value.trim() !== ''; })) records.push(row);
    if (records.length < 2) throw new Error('CSV must include a header row and at least one task.');

    function normalize(header) { return header.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s_-]+/g, ''); }
    var names = { taskid: 'taskId', assigneeid: 'assigneeId', createdon: 'createdOn', duedate: 'dueDate' };
    var columns = records[0].map(function (header) { return names[normalize(header)]; });
    if (columns.indexOf('dueDate') === -1) throw new Error('CSV must include a "Due Date" column.');
    var seen = {};
    columns.forEach(function (name) {
      if (!name) throw new Error('CSV has an unrecognized column. Use Task ID, Assignee ID, Created On, and Due Date.');
      if (seen[name]) throw new Error('CSV contains a duplicate column: ' + name + '.');
      seen[name] = true;
    });

    var tasks = records.slice(1).map(function (values, index) {
      if (values.length > columns.length) throw new Error('CSV row ' + (index + 2) + ' has more values than the header.');
      var task = {};
      columns.forEach(function (name, columnIndex) {
        var value = (values[columnIndex] || '').trim();
        if (value) task[name] = value;
      });
      return task;
    });
    if (tasks.length > 100) throw new Error('A maximum of 100 tasks can be submitted at once.');
    return tasks;
  }

  function getBatchTasks() {
    var file = $('csv-file').files[0];
    var json = $('batch-json').value.trim();
    if (json) {
      var parsed = JSON.parse(json);
      var tasks = Array.isArray(parsed) ? parsed : parsed && parsed.tasks;
      if (!Array.isArray(tasks)) throw new Error('JSON must be an array of tasks or an object containing a "tasks" array.');
      return Promise.resolve(tasks);
    }
    if (file) {
      if (file.size > 1048576) throw new Error('CSV file must be no larger than 1 MB.');
      return file.text().then(parseCsv);
    }
    throw new Error('Choose a CSV file or paste JSON tasks.');
  }

  function csvCell(value) {
    var text = value === null || value === undefined ? '' : String(value);
    if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  var batchResults = [];
  $('csv-file').addEventListener('change', function () {
    if (this.files.length) {
      $('batch-json').value = '';
      $('batch-status').textContent = this.files[0].name + ' selected';
    } else {
      $('batch-status').textContent = '';
    }
  });
  $('batch-json').addEventListener('input', function () {
    if (this.value.trim()) $('csv-file').value = '';
  });

  $('run-batch').addEventListener('click', function () {
    var button = this;
    var errorBox = $('batch-error');
    errorBox.hidden = true;
    $('batch-results').hidden = true;
    button.disabled = true;
    $('batch-status').textContent = 'Preparing tasks…';

    Promise.resolve().then(getBatchTasks).then(function (tasks) {
      if (tasks.length === 0) throw new Error('Add at least one task.');
      if (tasks.length > 100) throw new Error('A maximum of 100 tasks can be submitted at once.');
      $('batch-status').textContent = 'Scoring ' + tasks.length + ' tasks…';
      return fetch('/ui/score/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tasks: tasks }),
      }).then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      }).then(function (response) {
        if (!response.ok) {
          var error = response.data.error || {};
          throw new Error(error.message || 'Batch request failed.');
        }
        batchResults = response.data.results;
        renderBatchResults(tasks.length, batchResults);
      });
    }).catch(function (error) {
      errorBox.textContent = error instanceof SyntaxError ? 'JSON is not valid. Check the pasted content and try again.' : error.message;
      errorBox.hidden = false;
      $('batch-status').textContent = '';
    }).then(function () {
      button.disabled = false;
    });
  });

  function renderBatchResults(total, results) {
    var successes = results.filter(function (result) { return result.ok; }).length;
    $('batch-total').textContent = total;
    $('batch-success').textContent = successes;
    $('batch-failed').textContent = total - successes;
    var body = $('batch-rows');
    body.replaceChildren();

    results.forEach(function (result, index) {
      var row = document.createElement('tr');
      var taskCell = el('td', result.taskId || 'Task ' + (index + 1));
      var assigneeCell = el('td', result.assignee || 'Unknown');
      var probabilityCell = el('td', result.ok ? Math.round(result.probability * 100) + '%' : '—');
      var riskCell = el('td');
      if (result.ok) {
        riskCell.appendChild(el('span', result.riskLevel === 'higher' ? 'Higher' : 'Lower', 'risk-text ' + result.riskLevel));
      } else {
        riskCell.appendChild(el('span', 'Failed', 'risk-text higher'));
        var details = (result.error.details || []).map(function (detail) {
          return detail.field + ' ' + detail.message;
        }).join('; ');
        riskCell.appendChild(el('span', result.error.message + (details ? ': ' + details : ''), 'row-error'));
      }
      row.appendChild(taskCell);
      row.appendChild(assigneeCell);
      row.appendChild(probabilityCell);
      row.appendChild(riskCell);
      body.appendChild(row);
    });
    $('batch-status').textContent = '';
    $('batch-results').hidden = false;
  }

  $('download-results').addEventListener('click', function () {
    var rows = [['Task ID', 'Assignee', 'Overdue probability', 'Risk', 'Error']];
    batchResults.forEach(function (result, index) {
      var error = result.ok ? '' : result.error.message + ((result.error.details || []).length
        ? ': ' + result.error.details.map(function (detail) { return detail.field + ' ' + detail.message; }).join('; ')
        : '');
      rows.push([
        result.taskId || 'Task ' + (index + 1),
        result.assignee || 'Unknown',
        result.ok ? Math.round(result.probability * 100) + '%' : '',
        result.ok ? result.riskLevel : 'Failed',
        error,
      ]);
    });
    var csv = rows.map(function (row) { return row.map(csvCell).join(','); }).join('\r\n');
    var link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = 'overdue-risk-batch-results.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  });
})();
