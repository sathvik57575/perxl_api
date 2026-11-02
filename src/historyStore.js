const fs = require('fs');

/**
 * Where the assignee history comes from.
 *
 * This version reads the snapshot written by scripts/export_for_api.py (assignee_stats.json).
 * To use live data, keep the same two methods and query the PerXL database instead, for example:
 *   n    = count of the assignee's tasks with a known outcome (closed, or already overdue by the grace period)
 *   late = how many of those finished more than the grace period after their due date
 */
class JsonHistoryStore {
  constructor(path) {
    const data = JSON.parse(fs.readFileSync(path, 'utf8'));
    this.snapshotTime = data.snapshot_time;
    this.globalStats = data.global;
    this.assignees = data.assignees || {};
  }

  /** @returns {{n:number, late:number}|null} null when the assignee is unknown. */
  get(assigneeId) {
    return this.assignees[assigneeId] || null;
  }

  global() {
    return this.globalStats;
  }
}

module.exports = { JsonHistoryStore };
