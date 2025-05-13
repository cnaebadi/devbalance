import * as vscode from 'vscode';
let statusBarItem: vscode.StatusBarItem;
type TimerState = 'idle' | 'working' | 'break';
let timerState: TimerState = 'idle';
const player = require('play-sound')();
import * as path from 'path';
import * as fs from 'fs';

let active = false;
let intervalTimer: NodeJS.Timeout;
let workDuration = 25 * 60 * 1000; // 25 mins default
let breakDuration = 5 * 60 * 1000; // 5 mins default
let paused = false;
let workSeconds = 0;
let breakSeconds = 0;
let historyFilePath: string;
let globalContext: vscode.ExtensionContext;


export function activate(context: vscode.ExtensionContext) {

  globalContext = context;

  const storagePath = context.globalStorageUri.fsPath;
  if (!fs.existsSync(storagePath)) {
    fs.mkdirSync(storagePath, { recursive: true });
  }

  historyFilePath = path.join(storagePath, 'history.json');

  if (!fs.existsSync(historyFilePath)) {
    fs.writeFileSync(historyFilePath, JSON.stringify({}, null, 2));
  }

  const config = vscode.workspace.getConfiguration('devBalance');
  workDuration = (config.get<number>('workDurationMinutes') || 30) * 60 * 1000;
  breakDuration = (config.get<number>('breakDurationMinutes') || 5) * 60 * 1000;


  vscode.workspace.onDidChangeTextDocument(() => {
    lastTypingTime = Date.now();
    if (!active && timerState !== 'break') {
      startTimer();
    }
  });

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.show();

  const pauseButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  pauseButton.text = '🚫';
  pauseButton.tooltip = 'Pause Timer';
  pauseButton.command = 'devBalance.pauseTimer';
  pauseButton.show();

  const resumeButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
  resumeButton.text = '🎮';
  resumeButton.tooltip = 'Resume Timer';
  resumeButton.command = 'devBalance.resumeTimer';
  resumeButton.show();

  const resetButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
  resetButton.text = '♻️';
  resetButton.tooltip = 'Reset Timer';
  resetButton.command = 'devBalance.resetTimer';
  resetButton.show();

  const reportButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 96);
  reportButton.text = '💡';
  reportButton.tooltip = 'View Reports';
  reportButton.command = 'devBalance.selectReport';
  reportButton.show();


  context.subscriptions.push(
    statusBarItem , pauseButton, resumeButton, resetButton, reportButton,
    vscode.commands.registerCommand('devBalance.pauseTimer', pauseTimer),
    vscode.commands.registerCommand('devBalance.resumeTimer', resumeTimer),
    vscode.commands.registerCommand('devBalance.resetTimer', resetTimer),
    vscode.commands.registerCommand('devBalance.showDailyReport', showDailyReport),
    vscode.commands.registerCommand('devBalance.showMonthlyReport', showMonthlyReport),
    vscode.commands.registerCommand('devBalance.showYearlyReport', showYearlyReport),
    vscode.commands.registerCommand('devBalance.selectReport', selectReport),
    vscode.commands.registerCommand('devBalance.clearLogs', () => clearAllLogs(context)),
    vscode.commands.registerCommand('devBalance.showLogs', () => {
      const logs: Record<string, DailyLog> = globalContext.globalState.get('devBalanceLogs', {});
      
      const output = vscode.window.createOutputChannel('DevBalance Logs');
      output.clear();
      output.appendLine(JSON.stringify(logs, null, 2));
      output.show(true);
    })
    
  );
    vscode.workspace.onDidChangeConfiguration(e => {
      if (
        e.affectsConfiguration('devBalance.workDurationMinutes') ||
        e.affectsConfiguration('devBalance.breakDurationMinutes')
      ) {
        const config = vscode.workspace.getConfiguration('devBalance');
        workDuration = (config.get<number>('workDurationMinutes') || 30) * 60 * 1000;
        breakDuration = (config.get<number>('breakDurationMinutes') || 5) * 60 * 1000;
      }
      resetTimer();
    });

  updateStatusBar(0, true);
}

function startTimer() {
  if (timerState === 'working') return;
  clearInterval(intervalTimer);
  timerState = 'working';
  active = true;
  workSeconds = 0;
  paused = false;

  intervalTimer = setInterval(() => {
    if (!paused) {
      workSeconds += 1;
      updateStatusBar(workSeconds, true);

      if (workSeconds * 1000 >= workDuration) {
        clearInterval(intervalTimer);
        if (timerState === 'working') {
          timerState = 'idle';

          const hour = new Date().getHours();
          const minute = new Date().getMinutes();
          const hourly = Array(24).fill(0);
          const minuteLogs = Array(60).fill(0);
          hourly[hour] = workSeconds;
          minuteLogs[minute] = workSeconds;

          updateDailyLog(globalContext, {
            codingSeconds: workSeconds,
            hourlySeconds: hourly,
            minuteLogs: minuteLogs
          });

          playSound();
          vscode.window.showInformationMessage("🪫 Time to take a short break!");
          active = false;

          startBreakTimer();
        }
      }
    }
  }, 1000);
}


function startBreakTimer() {
  if (timerState === 'break') return;
  clearInterval(intervalTimer);
  timerState = 'break';
  active = true;
  breakSeconds = 0;
  paused = false;

  intervalTimer = setInterval(() => {
    if (!paused) {
      breakSeconds += 1;
      updateStatusBar(breakSeconds, false);

      if (breakSeconds * 1000 >= breakDuration) {
        clearInterval(intervalTimer);
        if (timerState === 'break') {
          timerState = 'idle';

          const hour = new Date().getHours();
          const minute = new Date().getMinutes();
          const hourly = Array(24).fill(0);
          const minuteBreaks = Array(60).fill(0);
          hourly[hour] = breakSeconds;
          minuteBreaks[minute] = breakSeconds;

          updateDailyLog(globalContext, {
            breaksTaken: 1,
            hourlyBreaks: hourly,
            minuteBreaks: minuteBreaks
          });

          playSound();
          vscode.window.showInformationMessage("✅ Break over, time to focus!");
          active = false;

          //startTimer();
        }
      }
    }
  }, 1000);
}


export function deactivate() {
  if (intervalTimer) {
    clearInterval(intervalTimer);
  }
}

function updateStatusBar(seconds: number, isWorking: boolean) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  const timeStr = `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  statusBarItem.text = isWorking ? `💻 Coding: ${timeStr}` : `☕ Break: ${timeStr}`;
}


function pauseTimer() {
  paused = true;
  vscode.window.showInformationMessage("📟 Timer paused.");
}

function resumeTimer() {
  if (paused) {
    paused = false;
    vscode.window.showInformationMessage("📟 Timer resumed.");
  }
}

function resetTimer() {
  clearInterval(intervalTimer);
  workSeconds = 0;
  breakSeconds = 0;
  paused = false;
  active = false;
  timerState = 'idle';
  updateStatusBar(0, true);
  vscode.window.showInformationMessage("📟 Timer reset.");
}

function playSound() {
  const config = vscode.workspace.getConfiguration('devBalance');
  const soundEnabled = config.get<boolean>('enableSound', true);
  if (!soundEnabled) return;

  const soundPath = path.join(__dirname, 'media', 'notify.wav');
  player.play(soundPath, (err: any) => {
    if (err) {
      console.error("Failed to play sound:", err);
    }
  });
}

type DailyLog = {
  date: string; // YYYY-MM-DD
  codingSeconds: number;
  breaksTaken: number;
  breakSeconds: number;
  hourlySeconds: number[];
  hourlyBreaks: number[];
  minuteLogs: number[];
  minuteBreaks: number[];
};


function updateDailyLog(context: vscode.ExtensionContext, update: Partial<DailyLog>) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const logs: Record<string, DailyLog> = context.globalState.get('devBalanceLogs', {});
  const current = logs[today] || {
    date: today,
    codingSeconds: 0,
    breaksTaken: 0,
    hourlySeconds: Array(24).fill(0),
    hourlyBreaks: Array(24).fill(0),
    minuteLogs: Array(60).fill(0),
    minuteBreaks: Array(60).fill(0)
  };

  const updatedHourlySeconds = current.hourlySeconds.slice();
  const updatedHourlyBreaks = current.hourlyBreaks.slice();
  const updatedMinuteLogs = current.minuteLogs.slice();
  const updatedMinuteBreaks = current.minuteBreaks.slice();

  if (update.hourlySeconds) {
    for (let i = 0; i < 24; i++) {
      updatedHourlySeconds[i] += update.hourlySeconds[i] || 0;
    }
  }

  if (update.hourlyBreaks) {
    for (let i = 0; i < 24; i++) {
      updatedHourlyBreaks[i] += update.hourlyBreaks[i] || 0;
    }
  }

  if (update.minuteLogs) {
    for (let i = 0; i < 60; i++) {
      updatedMinuteLogs[i] += update.minuteLogs[i] || 0;
    }
  }

  if (update.minuteBreaks) {
    for (let i = 0; i < 60; i++) {
      updatedMinuteBreaks[i] += update.minuteBreaks[i] || 0;
    }
  }

  logs[today] = {
    ...current,
    codingSeconds: current.codingSeconds + (update.codingSeconds || 0),
    breaksTaken: current.breaksTaken + (update.breaksTaken || 0),
    hourlySeconds: updatedHourlySeconds,
    hourlyBreaks: updatedHourlyBreaks,
    minuteLogs: updatedMinuteLogs,
    minuteBreaks: updatedMinuteBreaks
  };

  context.globalState.update('devBalanceLogs', logs);
}


function showDailyReport() {
  const today = new Date().toISOString().slice(0, 10);
  const logs: Record<string, DailyLog> = globalContext.globalState.get('devBalanceLogs', {});
  const todayLog = logs[today];

  if (!todayLog) {
    vscode.window.showInformationMessage("❌ No activity logged for today.");
    return;
  }

  const minutes = Math.floor(todayLog.codingSeconds / 60);
  const totalBreaks = todayLog.breaksTaken || 0;
  const breakSeconds = todayLog.minuteBreaks?.reduce((a, b) => a + b, 0) || 0;
  const breakMinutes = Math.floor(breakSeconds / 60);


  vscode.window.showInformationMessage(`📅 Today:\n🧑‍💻 Coding Time: ${minutes} min\n☕ Break Time: ${breakMinutes} min (${totalBreaks} breaks)`);
}


function showMonthlyReport() {
  const logs: Record<string, DailyLog> = globalContext.globalState.get('devBalanceLogs', {});
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7); // YYYY-MM

  let totalCodingSeconds = 0;
  let totalBreaks = 0;
  let totalBreakSeconds = 0;

  for (const date in logs) {
    if (date.startsWith(currentMonth)) {
      const log = logs[date];
      totalCodingSeconds += log.codingSeconds || 0;
      totalBreaks += log.breaksTaken || 0;
      totalBreakSeconds += (log.minuteBreaks?.reduce((a, b) => a + b, 0) || 0);
    }
  }

  const codingMinutes = Math.floor(totalCodingSeconds / 60);
  const breakMinutes = Math.floor(totalBreakSeconds / 60);

  vscode.window.showInformationMessage(`🗓️ This Month:\n🧑‍💻 Coding Time: ${codingMinutes} min\n☕ Break Time: ${breakMinutes} min (${totalBreaks} breaks)`);
}

function showYearlyReport() {
  const logs: Record<string, DailyLog> = globalContext.globalState.get('devBalanceLogs', {});
  const now = new Date();
  const currentYear = now.toISOString().slice(0, 4); // YYYY

  let totalCodingSeconds = 0;
  let totalBreaks = 0;
  let totalBreakSeconds = 0;

  for (const date in logs) {
    if (date.startsWith(currentYear)) {
      const log = logs[date];
      totalCodingSeconds += log.codingSeconds || 0;
      totalBreaks += log.breaksTaken || 0;
      totalBreakSeconds += (log.minuteBreaks?.reduce((a, b) => a + b, 0) || 0);
    }
  }

  const codingMinutes = Math.floor(totalCodingSeconds / 60);
  const breakMinutes = Math.floor(totalBreakSeconds / 60);

  vscode.window.showInformationMessage(`📆 This Year:\n🧑‍💻 Coding Time: ${codingMinutes} min\n☕ Break Time: ${breakMinutes} min (${totalBreaks} breaks)`);
}


async function selectReport() {
  const choice = await vscode.window.showQuickPick(['Daily', 'Monthly', 'Yearly'], {
    placeHolder: 'Choose a report type',
  });

  if (choice === 'Daily') {
    showChartReport('daily');
  } else if (choice === 'Monthly') {
    showChartReport('monthly');
  } else if (choice === 'Yearly') {
    showChartReport('yearly');
  }
}


function showChartReport(mode: 'daily' | 'monthly' | 'yearly') {
  const panel = vscode.window.createWebviewPanel(
    'devBalanceReport',
    `DevBalance - ${mode[0].toUpperCase() + mode.slice(1)} Report`,
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  const logs: Record<string, DailyLog> = globalContext.globalState.get('devBalanceLogs', {});
  const now = new Date();

  const labels: string[] = [];
  const coding: number[] = [];
  const breaks: number[] = [];


  if (mode === 'daily') {
    const today = now.toISOString().slice(0, 10);
    const log = logs[today] || { hourlySeconds: [], hourlyBreaks: [] };
  
    for (let i = 0; i < 24; i++) {
      const codingMinutes = Math.floor((log.hourlySeconds?.[i] || 0) / 60);
      const breakMinutes = Math.floor((log.hourlyBreaks?.[i] || 0) / 60);
      labels.push(i.toString().padStart(2, '0'));
      coding.push(parseFloat(((log?.hourlySeconds?.[i] || 0) / 60).toFixed(1)));
      breaks.push(breakMinutes);
    }
  }
  
  if (mode === 'monthly') {
    const yearMonth = now.toISOString().slice(0, 7);
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  
    for (let i = 1; i <= daysInMonth; i++) {
      const dayStr = i.toString().padStart(2, '0');
      const fullDate = `${yearMonth}-${dayStr}`;
      labels.push(dayStr);
      const log = logs[fullDate];
  
      const codingHours = log ? log.codingSeconds / 3600 : 0;
      const breakSeconds = log?.minuteBreaks?.reduce((a, b) => a + b, 0) || 0;
      const breakHours = breakSeconds / 3600;
  
      coding.push(parseFloat(codingHours.toFixed(2)));
      breaks.push(parseFloat(breakHours.toFixed(2)));
    }
  }

  if (mode === 'yearly') {
    const year = now.getFullYear().toString();
    const monthlyCodingSeconds = new Array(12).fill(0);
    const monthlyBreakSeconds = new Array(12).fill(0);
  
    for (const date in logs) {
      if (date.startsWith(year)) {
        const log = logs[date];
        const month = parseInt(date.split('-')[1], 10) - 1;
  
        monthlyCodingSeconds[month] += log?.codingSeconds || 0;
        const breakSeconds = log?.minuteBreaks?.reduce((a, b) => a + b, 0) || 0;
        monthlyBreakSeconds[month] += breakSeconds;
      }
    }
  
    for (let i = 0; i < 12; i++) {
      labels.push(new Date(2000, i).toLocaleString('default', { month: 'short' }));
      coding.push(parseFloat((monthlyCodingSeconds[i]).toFixed(2))); // هنوز به ثانیه
      breaks.push(parseFloat((monthlyBreakSeconds[i]).toFixed(2)));  // هنوز به ثانیه
    }
  }
  

  panel.webview.html = getChartHtml(labels, coding, breaks, mode);
}


function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}


function getChartHtml(labels: string[], codingData: number[], breaksData: number[], mode: string): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${mode} Report</title>
      <style>
        body {
          background-color: #1e1e1e;
          color: #e0e0e0;
          font-family: "Segoe UI", sans-serif;
          margin: 0;
          padding: 20px;
        }
        h2 {
          font-size: 18px;
          margin-bottom: 16px;
        }
        canvas {
          max-height: 400px;
          background-color: #121212;
          border-radius: 8px;
          padding: 12px;
        }
      </style>
    </head>
    <body>
      <h2>${capitalize(mode)} Report</h2>
      <canvas id="devChart"></canvas>
      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      <script>
        const mode = "${mode}";
        let labels = ${JSON.stringify(labels)};
        let coding = ${JSON.stringify(codingData)};
        let breaks = ${JSON.stringify(breaksData)};
        let yLabel = "";
        let unit = "";

        if (mode === "daily") {

          yLabel = "Minutes";
          unit = "min";
        } else if (mode === "monthly") {
          const max = Math.max(...coding, ...breaks);
          if (max < 1) {
            coding = coding.map(v => +(v * 60).toFixed(1)); // hours → minutes
            breaks = breaks.map(v => +(v * 60).toFixed(1));
            yLabel = "Minutes";
            unit = "min";
          } else {
            yLabel = "Hours";
            unit = "hr";
          }
        } else if (mode === "yearly") {

          const max = Math.max(...coding, ...breaks);

          if (max < 3600) {

            coding = coding.map(v => +(v / 60).toFixed(1));
            breaks = breaks.map(v => +(v / 60).toFixed(1));
            yLabel = "Minutes";
            unit = "min";
          } else if (max < 86400) {

            coding = coding.map(v => +(v / 3600).toFixed(1));
            breaks = breaks.map(v => +(v / 3600).toFixed(1));
            yLabel = "Hours";
            unit = "hr";
          } else {

            coding = coding.map(v => +(v / 86400).toFixed(1));
            breaks = breaks.map(v => +(v / 86400).toFixed(1));
            yLabel = "Days";
            unit = "day";
          }
        }

        const ctx = document.getElementById('devChart').getContext('2d');
        new Chart(ctx, {
          type: 'bar',
          data: {
            labels: labels,
            datasets: [
              {
                label: 'Coding',
                data: coding,
                backgroundColor: 'rgba(0, 172, 238, 0.7)',
                borderRadius: 4,
                barThickness: 12
              },
              {
                label: 'Breaks',
                data: breaks,
                backgroundColor: 'rgba(0, 200, 130, 0.6)',
                borderRadius: 4,
                barThickness: 12
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                labels: {
                  color: '#ccc',
                  font: { size: 12 }
                }
              },
              tooltip: {
                backgroundColor: '#333',
                titleColor: '#fff',
                bodyColor: '#eee',
                callbacks: {
                  label: function(context) {
                    return context.dataset.label + ": " + context.parsed.y + " " + unit;
                  }
                }
              }
            },
            scales: {
              x: {
                ticks: {
                  color: '#aaa',
                  font: { size: 10 }
                },
                grid: {
                  display: false
                }
              },
              y: {
                beginAtZero: true,
                ticks: {
                  color: '#aaa',
                  font: { size: 10 }
                },
                grid: {
                  color: '#333'
                },
                title: {
                  display: true,
                  text: yLabel,
                  color: '#ccc',
                  font: { size: 12 }
                }
              }
            }
          }
        });

        function capitalize(s) {
          return s.charAt(0).toUpperCase() + s.slice(1);
        }
      </script>
    </body>
    </html>
  `;
}

function clearAllLogs(context: vscode.ExtensionContext) {
  context.globalState.update('devBalanceLogs', {});
  vscode.window.showInformationMessage('🧹 All DevBalance logs have been cleared.');
}

