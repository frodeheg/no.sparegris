/* eslint-disable no-nested-ternary */

'use strict';

// Constants
const GRAPH_DATA_CONSUMPTION = 0;
const GRAPH_DATA_PRICES = 1;
const GRAPH_DATA_SAVINGS = 2;
const GRAPH_DATA_MAXHOUR = 3;

const INACURACY_THRESHOLD = 0.91; // 5 minutes - only affect colour

// Graphs
let chartId;
let chartContent = GRAPH_DATA_MAXHOUR;
let chartPeriod = GRANULARITY.DAY;
let chartYearIdx = 2022;
let chartMonthIdx = 0;
let chartDayIdx = 1;
let chartDaysInMonth = 31;
let chartHoursInDay = 24;
let chartSlotLength = 60;
let chartGranularity = 60;
let chartTime = new Date();
let chartStartTime = chartTime;
let chartEndTime = chartTime;
let chartAux;
let chartDataOk15;
let chartDataOk60;
let chartDataOk;

// Translation text
let textMaxHour = 'maxUsageGraph.title';
let textMaxHourQ = 'maxUsageGraph.titleQ';
let textConsumption = 'graph.consumption';
let textPrices = 'graph.prices';
let textSavings = 'graph.savings';
let textPredicted = 'graph.predicted';
let textHours = 'graph.hours';
let textYAxis = 'maxUsageGraph.yaxis';
let textXAxis = 'maxUsageGraph.xaxis';
let textTariff = 'maxUsageGraph.tariff';
let textMissing = 'maxUsageGraph.missing';
let textHighest = 'maxUsageGraph.highest';
let textHighestQ = 'maxUsageGraph.highestQ';
let textInaccurate = 'maxUsageGraph.inaccurate';
let textIncomplete = 'maxUsageGraph.incomplete';
let pricePointText = 'graph.pricePoint';
let priceDistributionText = 'graph.priceDistribution';
let unavailableText = 'graph.unavailable';
const textMonth = [
  'month.jan',
  'month.feb',
  'month.mar',
  'month.apr',
  'month.may',
  'month.jun',
  'month.jul',
  'month.aug',
  'month.sep',
  'month.oct',
  'month.nov',
  'month.dec',
];

function applyReliability(stats) {
  if (stats.slotLength['dataGood'] === 15) {
    chartDataOk15 = stats.dataGood || [];
    chartDataOk60 = [];
    for (let i = 0; i < (chartDataOk15.length / 4); i++) {
      chartDataOk60[i] = (+chartDataOk15[4 * i + 0] + +chartDataOk15[4 * i + 1] + +chartDataOk15[4 * i + 2] + +chartDataOk15[4 * i + 3]) / 4;
    }
  } else {
    chartDataOk15 = [];
    chartDataOk60 = stats.dataGood || [];
  }
}

function generateConsumptionData(stats) {
  // Calculate values
  const dataset = stats.data.powUsage || [];
  applyReliability(stats);
  // Generate data
  const multiplier = 60 / chartSlotLength;
  const colorBars = Array(chartDaysInMonth * multiplier).fill('pink');
  const colorBarLines = Array(chartDaysInMonth * multiplier).fill('black');
  chartDataOk = (chartSlotLength === 15) ? chartDataOk15 : chartDataOk60;
  for (let i = 0; i < chartDaysInMonth * multiplier; i++) {
    let barCol = '80,160,80';
    let barAlpha = 1;
    let lineAlpha = 1;
    if (chartDataOk[i] < INACURACY_THRESHOLD) {
      barCol = '170,80,80';
    }

    const now = new Date();
    if ((i === dataset.length - 1)
      && (chartPeriod !== GRANULARITY.HOUR)
      && (now >= chartStartTime)
      && (now <= chartEndTime)) {
      barAlpha = 0.3;
      lineAlpha = 0.3;
    }
    colorBars[i] = `rgb(${barCol},${barAlpha})`;
    colorBarLines[i] = `rgb(0,0,0,${lineAlpha})`;
  }
  return [{
    type: 'bar',
    label: textConsumption,
    backgroundColor: colorBars,
    borderColor: colorBarLines,
    borderWidth: (chartSlotLength === 15) ? 0 : 1,
    data: dataset.map(x => Math.round(x) / 1000),
  }];
}

function generateConsumptionOptions(stats, graphTitle) {
  const dataset = stats.data.powUsage || [];
  chartDataOk = (chartSlotLength === 15) ? chartDataOk15 : chartDataOk60;
  return {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        title: {
          display: true,
          text: textYAxis,
        },
        ticks: {
          callback(value, index, ticks) {
            return (+value).toFixed(2);
          },
        },
      },
    },
    interaction: {
      intersect: false,
      mode: 'index',
    },
    plugins: {
      tooltip: {
        callbacks: {
          title(context) {
            return `${textMonth[chartMonthIdx]} ${context[0].label}`;
          },
          beforeFooter(context) {
            if (!dataset[context[0].dataIndex]) return textMissing;
            const now = new Date();
            if ((context[0].dataIndex === dataset.length - 1)
              && (chartPeriod !== GRANULARITY.HOUR)
              && (now > chartStartTime)
              && (now < chartEndTime)) {
              return textIncomplete;
            }
            if (chartDataOk[context[0].dataIndex] < 0) return textInaccurate.slice(0, textInaccurate.indexOf('\n')); // Legacy archive before v. 0.19.27
            if (chartDataOk[context[0].dataIndex] < 1) return textInaccurate.replace('${percent}', Math.round(100 * (1 - chartDataOk[context[0].dataIndex])));
            return '';
          },
        },
      },
      legend: {
        display: false,
        position: 'right',
        labels: {
          boxWidth: 10,
          font: {
            size: 9,
          },
        },
      },
      title: {
        display: true,
        text: graphTitle,
        font: {
          size: 15,
        },
      },
    },
  };
}

function generateHourlyMaxData(stats) {
  // Calculate values
  const dataset = stats.data.maxPower || [];
  applyReliability(stats);
  const dataIsQuarterMax = stats.slotLength.dataGood === 15;
  const showSteps = !dataIsQuarterMax;
  const multiplier = dataIsQuarterMax ? 4 : 1;
  const maxDays = showSteps ? getMax3(dataset) : [dataset.indexOf(Math.max(...dataset))];
  const peakMin = +document.getElementById('peakMin').value;
  const tariffGuide = Math.max(Math.round(averageOfElements(dataset, maxDays)) * multiplier, peakMin);
  const tariffAbove = showSteps ? getGridAbove(tariffGuide) : (tariffGuide * 1.02);
  const tariffBelow = showSteps ? getGridBelow(tariffGuide) : (tariffGuide * 0.98);
  // Generate data
  const maxDataLength = (chartPeriod === GRANULARITY.DAY) ? chartDaysInMonth : dataset.length;

  const dataTariffAbove = Array(maxDataLength).fill(tariffAbove / 1000);
  const dataTariffBelow = Array(maxDataLength).fill(tariffBelow / 1000);
  const dataTariffGuide = Array(maxDataLength).fill(tariffGuide / 1000);
  const colorBars = Array(maxDataLength).fill('pink');
  const colorBarLines = Array(maxDataLength).fill('black');
  const showMonth = (+chartPeriod === GRANULARITY.DAY);
  chartDataOk = (chartSlotLength === 15) ? chartDataOk15 : chartDataOk60;
  for (let i = 0; i < maxDataLength; i++) {
    let barCol = '80,160,80';
    let barAlpha = 1;
    let lineCol = '0,0,0';
    let lineAlpha = 1;
    if (showMonth && maxDays.includes(i)) {
      lineCol = '0,0,128';
      barCol = '80,210,80';
    }
    if (chartDataOk[i] < INACURACY_THRESHOLD) {
      barCol = '170,80,80';
    }
    const now = new Date();
    if ((i === dataset.length - 1)
      && (chartPeriod !== GRANULARITY.HOUR)
      && (now > chartStartTime)
      && (now < chartEndTime)) {
      barAlpha = 0.3;
      lineAlpha = 0.3;
    }
    colorBars[i] = `rgb(${barCol},${barAlpha})`;
    colorBarLines[i] = `rgb(${lineCol},${lineAlpha})`;
  }
  return [{
    type: 'line',
    label: 'Trinn 3',
    borderColor: showMonth && showSteps ? 'black' : 'rgba(0,0,0,0)',
    pointBackgroundColor: showMonth && showSteps ? 'black' : 'rgba(0,0,0,0)',
    data: dataTariffAbove,
    borderWidth: 1,
    pointRadius: 0,
  }, {
    type: 'line',
    label: 'Trinn 2',
    borderColor: showMonth && showSteps ? 'black' : 'rgba(0,0,0,0)',
    pointBackgroundColor: showMonth && showSteps ? 'black' : 'rgba(0,0,0,0)',
    data: dataTariffBelow,
    borderWidth: 1,
    pointRadius: 0,
  }, {
    type: 'line',
    label: textTariff,
    borderDash: [10, 5],
    borderColor: showMonth ? 'gray' : 'rgba(0,0,0,0)',
    pointBackgroundColor: showMonth ? 'gray' : 'rgba(0,0,0,0)',
    borderWidth: 1.5,
    pointRadius: 0,
    data: dataTariffGuide,
  }, {
    type: 'bar',
    label: (chartPeriod === GRANULARITY.HOUR && chartGranularity === 60) ? textConsumption : (chartGranularity === 15) ? textHighestQ : textHighest,
    backgroundColor: colorBars,
    borderColor: colorBarLines,
    borderWidth: (chartSlotLength === 15) ? 0 : 1,
    data: dataset.map(x => Math.round(x * multiplier) / 1000),
  }];
}

function generateHourlyMaxOptions(stats, graphTitle) {
  const dataset = stats.data.maxPower || [];
  chartDataOk = (chartSlotLength === 15) ? chartDataOk15 : chartDataOk60;
  return {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        title: {
          display: true,
          text: textYAxis,
        },
        ticks: {
          callback(value, index, ticks) {
            return (+value).toFixed(2);
          },
        },
      },
    },
    interaction: {
      intersect: false,
      mode: 'index',
    },
    plugins: {
      tooltip: {
        callbacks: {
          title(context) {
            return `${textMonth[chartMonthIdx]} ${context[0].label}`;
          },
          beforeFooter(context) {
            if (!dataset[context[0].dataIndex]) return textMissing;
            const now = new Date();
            if ((context[0].dataIndex === dataset.length - 1)
              && (chartPeriod !== GRANULARITY.HOUR)
              && (now > chartStartTime)
              && (now < chartEndTime)) {
              return textIncomplete;
            }
            if (chartDataOk[context[0].dataIndex] < 0) return textInaccurate.slice(0, textInaccurate.indexOf('\n')); // Legacy archive before v. 0.19.27
            if (chartDataOk[context[0].dataIndex] < 1) return textInaccurate.replace('${percent}', Math.round(100 * (1 - chartDataOk[context[0].dataIndex])));
            return '';
          },
        },
        filter(context) {
          if (context.dataset.label.startsWith('Trinn')) return false;
          if (context.dataset.label === textTariff && chartPeriod !== GRANULARITY.DAY) return false;
          return true;
        },
      },
      legend: {
        display: false,
        position: 'right',
        labels: {
          boxWidth: 10,
          font: {
            size: 9,
          },
        },
      },
      title: {
        display: true,
        text: graphTitle,
        font: {
          size: 15,
        },
      },
    },
  };
}

function generatePriceData(stats) {
  // Calculate values
  applyReliability(stats);
  chartDataOk = (chartSlotLength === 15) ? chartDataOk15 : chartDataOk60;
  const perHour = (chartPeriod === GRANULARITY.HOUR);
  const dataset = stats.data.price || [];
  chartAux = Array.isArray(stats.data.pricePoints) ? stats.data.pricePoints : []; // 0: PP_LOW, 1: PP_NORM, 2: PP_HIGH, 3: PP_EXTREME, 4: PP_DIRTCHEAP
  const perDayCount = [];
  for (let i = 0; i < stats.daysInMonth; i++) {
    if (!perHour) {
      chartAux[i] = Array.isArray(chartAux[i]) ? chartAux[i] : [];
      for (let j = 0; j < 5; j++) {
        chartAux[i][j] = chartAux[i][j] ? chartAux[i][j] : 0;
      }
      perDayCount[i] = chartAux[i].reduce((a, b) => a + b, 0);
    }
  }
  const ppMax = dataset.filter((p, i) => (p !== null)).reduce((a, b) => { return a === undefined ? b : Math.max(a, b); }, 0);
  const ppExtremeMin = dataset.filter((p, i) => (+chartAux[i] === PP.EXTREME)).reduce((a, b) => { return a === undefined ? b : Math.min(a, b); }, ppMax);
  const ppHighMin = dataset.filter((p, i) => (+chartAux[i] === PP.HIGH)).reduce((a, b) => { return a === undefined ? b : Math.min(a, b); }, ppExtremeMin);
  const ppNormMin = dataset.filter((p, i) => (+chartAux[i] === PP.NORM)).reduce((a, b) => { return a === undefined ? b : Math.min(a, b); }, ppHighMin);
  const ppLowMin = dataset.filter((p, i) => (+chartAux[i] === PP.LOW)).reduce((a, b) => { return a === undefined ? b : Math.min(a, b); }, ppNormMin);

  let ppDirtMax = Math.min(dataset.filter((p, i) => (+chartAux[i] === PP.DIRTCHEAP)).reduce((a, b) => { return a === undefined ? b : Math.max(a, b); }, undefined) || 0, ppLowMin);
  const ppMin = dataset.filter((p, i) => (p !== null)).reduce((a, b) => { return a === undefined ? b : Math.min(a, b); }, Infinity);
  if (!ppDirtMax) ppDirtMax = Math.max(ppMin - (ppMax - ppMin) * 0.9, 0);
  const ppLowMax = Math.min(dataset.filter((p, i) => (+chartAux[i] === PP.LOW)).reduce((a, b) => { return a === undefined ? b : Math.max(a, b); }, ppDirtMax), ppNormMin);
  const ppNormMax = Math.min(dataset.filter((p, i) => (+chartAux[i] === PP.NORM)).reduce((a, b) => { return a === undefined ? b : Math.max(a, b); }, ppLowMax), ppHighMin);
  const ppHighMax = Math.min(dataset.filter((p, i) => (+chartAux[i] === PP.HIGH)).reduce((a, b) => { return a === undefined ? b : Math.max(a, b); }, ppNormMax), ppExtremeMin);

  const colDirt = 'rgba(0,255,0,0.5)';
  const colCheap = 'rgba(0,128,0,0.5)';
  const colNorm = 'rgba(0,128,255,0.4)';
  const colHigh = 'rgba(128,0,0,0.3)';
  const colExtreme = 'rgba(255,0,0,0.2)';
  const skipped = (ctx, value) => (ctx.p0.skip || ctx.p1.skip ? value : undefined);
  const future = (ctx, value) => (chartDataOk[ctx.p0DataIndex] === undefined ? value : undefined);
  const chartData = [{
    type: 'line',
    stepped: perHour,
    tension: 0.4,
    fill: true,
    label: 'Dirt Cheap limit',
    borderColor: colDirt,
    backgroundColor: colDirt,
    pointBackgroundColor: colDirt,
    data: dataset.map((x, idx) => (x ? (perHour ? ((+chartAux[idx] === PP.DIRTCHEAP) ? x : Math.min(x, ppDirtMax)) : (x * (perDayCount[idx] ? chartAux[idx][4] / perDayCount[idx] : 1))) : undefined)),
    borderWidth: 1,
    pointRadius: 0,
    segment: {
      borderColor: ctx => future(ctx, 'rgba(0,255,0,0.2)'),
      backgroundColor: ctx => future(ctx, 'rgba(0,255,0,0.2)'),
    },
  },
  {
    type: 'line',
    stepped: perHour,
    tension: 0.4,
    fill: true,
    label: 'Cheap limit',
    borderColor: colCheap,
    backgroundColor: colCheap,
    pointBackgroundColor: colCheap,
    data: dataset.map((x, idx) => (x ? (perHour ? ((+chartAux[idx] === PP.LOW) ? x : Math.min(x, ppLowMax)) : (x * (perDayCount[idx] ? (chartAux[idx][4] + chartAux[idx][0]) / perDayCount[idx] : 1))) : undefined)),
    borderWidth: 1,
    pointRadius: 0,
    segment: {
      borderColor: ctx => future(ctx, 'rgba(0,128,0,0.2)'),
      backgroundColor: ctx => future(ctx, 'rgba(0,128,0,0.2)'),
    },
  },
  {
    type: 'line',
    stepped: perHour,
    tension: 0.4,
    fill: true,
    label: 'Normal limit',
    borderColor: colNorm,
    backgroundColor: colNorm,
    pointBackgroundColor: colNorm,
    data: dataset.map((x, idx) => (x ? (perHour ? ((+chartAux[idx] === PP.NORM) ? x : Math.min(x, ppNormMax)) : (x * (perDayCount[idx] ? (chartAux[idx][4] + chartAux[idx][0] + chartAux[idx][1]) / perDayCount[idx] : 1))) : undefined)),
    borderWidth: 1,
    pointRadius: 0,
    segment: {
      borderColor: ctx => future(ctx, 'rgba(0,128,255,0.2)'),
      backgroundColor: ctx => future(ctx, 'rgba(0,128,255,0.2)'),
    },
  },
  {
    type: 'line',
    stepped: perHour,
    tension: 0.4,
    fill: true,
    label: 'Expensive limit',
    borderColor: colHigh,
    backgroundColor: colHigh,
    pointBackgroundColor: colHigh,
    data: dataset.map((x, idx) => (x ? (perHour ? ((+chartAux[idx] === PP.HIGH) ? x : Math.min(x, ppHighMax)) : (x * (perDayCount[idx] ? (chartAux[idx][4] + chartAux[idx][0] + chartAux[idx][1] + chartAux[idx][2]) / perDayCount[idx] : 1))) : undefined)),
    borderWidth: 1,
    pointRadius: 0,
    segment: {
      borderColor: ctx => future(ctx, 'rgba(128,0,0,0.2)'),
      backgroundColor: ctx => future(ctx, 'rgba(128,0,0,0.2)'),
    },
  },
  {
    type: 'line',
    stepped: perHour,
    tension: 0.4,
    fill: true,
    label: 'Very Expensive limit',
    borderColor: colExtreme,
    backgroundColor: colExtreme,
    pointBackgroundColor: colExtreme,
    data: dataset.map(x => x),
    borderWidth: 1,
    pointRadius: 0,
    segment: {
      borderColor: ctx => future(ctx, 'rgba(255,0,0,0.1)'),
      backgroundColor: ctx => future(ctx, 'rgba(255,0,0,0.1)'),
    },
  },
  {
    type: 'line',
    stepped: perHour,
    spanGaps: true,
    tension: 0.4,
    fill: true,
    label: chargePlanGraphPrice,
    visible: true,
    borderColor: 'black',
    backgroundColor: 'rgb(0,0,0,0)',
    pointBackgroundColor: 'black',
    data: dataset.map(x => x),
    borderWidth: 1,
    pointRadius: 0,
    segment: {
      borderColor: ctx => skipped(ctx, 'rgb(0,0,0,0.6)') || future(ctx, 'rgb(0,0,0,0)'),
      backgroundColor: ctx => skipped(ctx, 'rgb(0,0,0,0.2') || future(ctx, 'rgb(0,0,0,0)'),
      borderDash: ctx => skipped(ctx, [6, 6]),
    },
  }];
  return chartData;
}

function generatePriceOptions(stats, graphTitle) {
  chartDataOk = (chartSlotLength === 15) ? chartDataOk15 : chartDataOk60;
  return {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        title: {
          display: true,
          text: document.getElementById('currency').value,
        },
        ticks: {
          callback(value, index, ticks) {
            return `${(+value).toFixed(2)}`;
          },
        },
      },
    },
    interaction: {
      intersect: false,
      mode: 'index',
    },
    plugins: {
      tooltip: {
        callbacks: {
          title(context) {
            if (context[0]) return `${graphTitle} - ${context[0].label}`;
            return graphTitle;
          },
          beforeFooter(context) {
            const isFutureValue = context[0] && (chartDataOk[context[0].dataIndex] === undefined);
            const predictionText = isFutureValue ? ` (${textPredicted})` : '';
            const dataOkText = (isFutureValue || !context[0]) ? ''
              : (chartDataOk[context[0].dataIndex] >= 1) ? ''
                : (chartDataOk[context[0].dataIndex] >= 0) ? `\n${textInaccurate.replace('${percent}', Math.round(100 * (1 - chartDataOk[context[0].dataIndex])))}`
                  : `\n${textInaccurate.slice(0, textInaccurate.indexOf('\n'))}`; // Legacy archive before v. 0.19.27
            if (+chartPeriod === GRANULARITY.HOUR) {
              let ppName;
              try {
                ppName = `${pricePoints.filter(i => (i.value === chartAux[context[0].dataIndex]))[0].name}${predictionText}${dataOkText}`;
              } catch (err) {
                ppName = unavailableText;
              }
              return `${pricePointText}: ${ppName}`;
            }
            let dayData;
            try {
              dayData = chartAux[context[0].dataIndex];
            } catch (err) {
              dayData = undefined;
            }
            if (!Array.isArray(dayData)) return `${priceDistributionText}: ${unavailableText}`;
            return `${priceDistributionText}:\n`
              + `  ${pricePoints[0].name}: ${dayData[pricePoints[0].value]} ${textHours}\n`
              + `  ${pricePoints[1].name}: ${dayData[pricePoints[1].value]} ${textHours}\n`
              + `  ${pricePoints[2].name}: ${dayData[pricePoints[2].value]} ${textHours}\n`
              + `  ${pricePoints[3].name}: ${dayData[pricePoints[3].value]} ${textHours}\n`
              + `  ${pricePoints[4].name}: ${dayData[pricePoints[4].value]} ${textHours}${dataOkText}`;
          },
        },
        filter(context) {
          if (context.dataset.visible !== true) return false;
          return true;
        },
      },
      legend: {
        display: false,
        position: 'right',
        labels: {
          boxWidth: 10,
          font: {
            size: 9,
          },
        },
      },
      title: {
        display: true,
        text: graphTitle,
        font: {
          size: 15,
        },
      },
    },
  };
}

function updateGraph(Homey) {
  let chartHeader;
  let graphTypeRequest;
  switch (chartContent) {
    default:
    case GRAPH_DATA_MAXHOUR:
      chartHeader = (chartGranularity === 15) ? textMaxHourQ : textMaxHour;
      graphTypeRequest = ['maxPower']; // overShootAvoided
      break;
    case GRAPH_DATA_CONSUMPTION:
      chartHeader = textConsumption;
      graphTypeRequest = ['powUsage'];
      break;
    case GRAPH_DATA_PRICES:
      chartHeader = textPrices;
      graphTypeRequest = ['price', 'pricePoints']; // pricePoints
      break;
    case GRAPH_DATA_SAVINGS:
      chartHeader = textSavings;
      graphTypeRequest = ['moneySavedTariff', 'moneySavedUsage'];
      break;
  }
  Homey.api('GET', `/getStats?type=[${graphTypeRequest.join(',')}]&time=${chartTime.getTime()}&granularity=${chartPeriod}`, null,
    (err, res) => {
      if (err) return alertUser(Homey, err);
      chartMonthIdx = res.localMonth;
      chartYearIdx = res.localYear;
      chartDayIdx = res.localDay;
      chartDaysInMonth = res.daysInMonth;
      chartHoursInDay = res.hoursInDay;
      const slotLengthArray = res.slotLength;
      chartTime = new Date(res.localTime);
      let chartSlotsInDay;
      let timeString;
      let labels;
      switch (chartPeriod) {
        case GRANULARITY.MONTH:
          timeString = `${chartYearIdx}`;
          labels = textMonth;
          chartStartTime = new Date(`${chartYearIdx}`);
          chartEndTime = new Date(chartStartTime.getTime() + (1000 * 60 * 60 * 24 * 365));
          break;
        case GRANULARITY.DAY:
          timeString = textMonth[chartMonthIdx];
          labels = Array.from(Array(chartDaysInMonth + 1).keys()).slice(1);
          chartStartTime = new Date(`${chartYearIdx}-${chartMonthIdx+1}`);
          chartEndTime = new Date(chartStartTime.getTime() + (1000 * 60 * 60 * 24 * chartDaysInMonth));
          break;
        case GRANULARITY.HOUR:
          chartSlotLength = slotLengthArray[graphTypeRequest[0]];
          chartSlotsInDay = chartHoursInDay * (60 / chartSlotLength);
          timeString = `${textMonth[chartMonthIdx]} - ${chartDayIdx}`;
          labels = (chartSlotLength === 15)
            ? Array.from(Array(chartSlotsInDay).keys()).map(s => `${Math.floor(s / 4)}:${String(15 * (s % 4)).padStart(2, '0')}`)
            : Array.from(Array(chartSlotsInDay).keys()).map(h => `${h}:00`);
          chartStartTime = new Date(`${chartYearIdx}-${chartMonthIdx + 1}-${chartDayIdx}`);
          chartEndTime = new Date(chartStartTime.getTime() + (1000 * 60 * chartSlotLength * chartSlotsInDay));
          break;
        default:
      }
      chartId.data.labels = labels;
      const graphTitle = `${chartHeader} - ${timeString}`;
      switch (chartContent) {
        case GRAPH_DATA_MAXHOUR:
          chartId.data.datasets = generateHourlyMaxData(res);
          chartId.options = generateHourlyMaxOptions(res, graphTitle);
          break;
        case GRAPH_DATA_CONSUMPTION:
          chartId.data.datasets = generateConsumptionData(res);
          chartId.options = generateConsumptionOptions(res, graphTitle);
          break;
        case GRAPH_DATA_PRICES:
          chartId.data.datasets = generatePriceData(res);
          chartId.options = generatePriceOptions(res, graphTitle);
          break;
        case GRAPH_DATA_SAVINGS:
          chartId.data.datasets = []; //generateSavingsData(res);
          chartId.options = {}; //generateSavingsOptions(res, graphTitle);
          break;
        default:
      }
      // Homey.api('GET', `/apiCommand?cmd=log&text=atdetvarat${timeString}&loglevel=0`, null, function (err2, result) {});
      return chartId.update();
    });
}

function onShowMaxHourGraph(Homey) {
  console.log('onShowMaxHourGraph');
  chartContent = GRAPH_DATA_MAXHOUR;
  updateGraph(Homey);
}

function onShowConsumptionGraph(Homey) {
  console.log('onShowConsumptionGraph');
  chartContent = GRAPH_DATA_CONSUMPTION;
  updateGraph(Homey);
}

function onShowPricesGraph(Homey) {
  chartContent = GRAPH_DATA_PRICES;
  updateGraph(Homey);
}

function onShowSavingsGraph(Homey) {
  chartContent = GRAPH_DATA_SAVINGS;
  updateGraph(Homey);
}

function onShowDayTimespan(Homey) {
  chartPeriod = GRANULARITY.HOUR;
  updateGraph(Homey);
}

function onShowMonthTimespan(Homey) {
  chartPeriod = GRANULARITY.DAY;
  updateGraph(Homey);
}

function onShowYearTimespan(Homey) {
  chartPeriod = GRANULARITY.MONTH;
  updateGraph(Homey);
}

function onBackClick(Homey) {
  switch (chartPeriod) {
    default:
    case GRANULARITY.HOUR:
      chartTime.setUTCDate(chartTime.getUTCDate() - 1);
      break;
    case GRANULARITY.DAY:
      chartTime.setUTCMonth(chartTime.getUTCMonth() - 1);
      break;
    /* case GRAPH_PERIOD_WEEK:
      chartTime.setUTCDate(chartTime.getUTCDate() - 7);
      break; */
    case GRANULARITY.MONTH:
      chartTime.setUTCFullYear(chartTime.getUTCFullYear() - 1);
      break;
  }
  updateGraph(Homey);
}

function onForwardClick(Homey) {
  switch (chartPeriod) {
    case GRANULARITY.HOUR:
      chartTime.setUTCDate(chartTime.getUTCDate() + 1);
      break;
    default:
    case GRANULARITY.DAY:
      chartTime.setUTCMonth(chartTime.getUTCMonth() + 1);
      break;
    /* case GRAPH_PERIOD_WEEK:
      chartTime.setUTCDate(chartTime.getUTCDate() + 7);
      break; */
    case GRANULARITY.MONTH:
      chartTime.setUTCFullYear(chartTime.getUTCFullYear() + 1);
      break;
  }
  updateGraph(Homey);
}

function InitGraph(Homey, stats, granularity) {
  // Translate strings
  textMaxHour = Homey.__(textMaxHour);
  textMaxHourQ = Homey.__(textMaxHourQ);
  textConsumption = Homey.__(textConsumption);
  textPrices = Homey.__(textPrices);
  textSavings = Homey.__(textSavings);
  textPredicted = Homey.__(textPredicted);
  textHours = Homey.__(textHours);
  textYAxis = Homey.__(textYAxis);
  textXAxis = Homey.__(textXAxis);
  textTariff = Homey.__(textTariff);
  textMissing = Homey.__(textMissing);
  textHighest = Homey.__(textHighest);
  textHighestQ = Homey.__(textHighestQ);
  textInaccurate = Homey.__(textInaccurate);
  textIncomplete = Homey.__(textIncomplete);
  pricePointText = Homey.__(pricePointText);
  priceDistributionText = Homey.__(priceDistributionText);
  unavailableText = Homey.__(unavailableText);
  for (let i = 0; i < textMonth.length; i++) {
    textMonth[i] = Homey.__(textMonth[i]);
  }

  // Remember Chart latent state
  chartMonthIdx = stats.localMonth;
  chartDaysInMonth = stats.daysInMonth;
  chartHoursInDay = stats.hoursInDay;
  chartSlotLength = stats.slotLength.maxPower;
  chartGranularity = granularity;
  chartTime = new Date(stats.localTime);
  chartStartTime = new Date(chartTime.getTime());
  chartEndTime = new Date(chartStartTime.getTime() + (1000 * 60 * 60 * 24 * chartDaysInMonth));

  // Generate labels
  const dataDays = Array.from(Array(chartDaysInMonth + 1).keys()).slice(1);

  if (chartId === undefined) {
    chartId = new Chart('tariffGuideChart', {
      labels: dataDays,
      data: generateHourlyMaxData(stats),
      options: generateHourlyMaxOptions(stats, 'N/A'),
    });
  }
  updateGraph(Homey);
  document.getElementById('tariffGuideChart').style.display = 'block';
}

module.exports = {
  onShowMaxHourGraph,
  onShowConsumptionGraph,
  onShowPricesGraph,
  onShowSavingsGraph,
  onShowDayTimespan,
  onShowMonthTimespan,
  onShowYearTimespan,
  onBackClick,
  onForwardClick,
  InitGraph,
  updateGraph,
};

// When including this file in a web-page, inform the main page that loading is complete
if (typeof onScriptLoaded === 'function') {
  onScriptLoaded('graphs.js');
} // else the script is not used in a web-page
