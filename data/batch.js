const tasks = Array.from({ length: 100 }, (_, i) => {
  const createdOn = new Date("2026-10-01T09:00:00Z");

  // Different creation dates
  createdOn.setDate(createdOn.getDate() + (i % 20));

  const dueDate = new Date(createdOn);

  // Different lead times: 3–15 days
  dueDate.setDate(dueDate.getDate() + 3 + (i % 13));

  return {
    taskId: `BATCH-${String(i + 1).padStart(3, "0")}`,
    assigneeId: `ASSIGNEE-${(i % 10) + 1}`,
    createdOn: createdOn.toISOString(),
    dueDate: dueDate.toISOString()
  };
});

console.log(JSON.stringify({ tasks }, null, 2));