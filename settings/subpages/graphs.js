/* eslint-disable no-nested-ternary */

'use strict';

// Constants
const GRAPH_DATA_CONSUMPTION = 0;
const GRAPH_DATA_PRICES = 1;
const GRAPH_DATA_SAVINGS = 2;
const GRAPH_DATA_MAXHOUR = 3;

// Graphs
let chartId;
let chartContent = GRAPH_DATA_MAXHOUR;
let chartPeriod = GRANULARITY.DAY;
let chartYearIdx = 2022;
let chartMonthIdx = 0;
let chartDayIdx = 1;
let chartDaysInMonth = 31;
let chartHoursInDay = 24;
let chartTime = new Date();
let chartStartTime = chartTime;
let chartEndTime = chartTime;
let chartAux;
let chartDataOk;

// Translation text
let textMaxHour = 'maxUsageGraph.title';
let textConsumption = 'graph.consumption';
let textPrices = 'graph.prices';
let textSavings = 'graph.savings';

function generateConsumptionData(stats) {
  // Calculate values
  const dataset = stats.data.powUsage || [];
  chartDataOk = stats.dataGood || [];
  // Generate data
  const colorBars = Array(chartDaysInMonth).fill('pink');
  const colorBarLines = Array(chartDaysInMonth).fill('black');
  for (let i = 0; i < chartDaysInMonth; i++) {
    let barCol = '80,160,80';
    let barAlpha = 1;
    let lineAlpha = 1;
    if (!chartDataOk[i]) {
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
    label: chartPeriod === GRANULARITY.HOUR ? textConsumption : graphHighest,
    backgroundColor: colorBars,
    borderColor: colorBarLines,
    borderWidth: 1,
    data: dataset.map(x => Math.round(x)),
  }];
}

function generateConsumptionOptions(stats, graphTitle) {
  const dataset = stats.data.powUsage || [];
  chartDataOk = stats.dataGood || [];
  return {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        title: {
          display: true,
          text: graphYAxis,
        },
        ticks: {
          callback(value, index, ticks) {
            return (value / 1000).toFixed(2);
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
            return `${monthText[chartMonthIdx]} ${context[0].label}`;
          },
          beforeFooter(context) {
            if (!dataset[context[0].dataIndex]) return graphMissing;
            if (!chartDataOk[context[0].dataIndex]) return graphInaccurate;
            const now = new Date();
            if ((context[0].dataIndex === dataset.length - 1)
              && (chartPeriod !== GRANULARITY.HOUR)
              && (now > chartStartTime)
              && (now < chartEndTime)) {
              return graphIncomplete;
            }
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
  chartDataOk = stats.dataGood || [];
  const maxDays = getMax3(dataset);
  const tariffGuide = Math.round(averageOfElements(dataset, maxDays));
  const tariffAbove = getGridAbove(tariffGuide);
  const tariffBelow = getGridBelow(tariffGuide);
  // Generate data
  const dataTariffAbove = Array(chartDaysInMonth).fill(tariffAbove);
  const dataTariffBelow = Array(chartDaysInMonth).fill(tariffBelow);
  const dataTariffGuide = Array(chartDaysInMonth).fill(tariffGuide);
  const colorBars = Array(chartDaysInMonth).fill('pink');
  const colorBarLines = Array(chartDaysInMonth).fill('black');
  const showMonth = (+chartPeriod === GRANULARITY.DAY);
  for (let i = 0; i < chartDaysInMonth; i++) {
    let barCol = '80,160,80';
    let barAlpha = 1;
    let lineCol = '0,0,0';
    let lineAlpha = 1;
    if (showMonth && maxDays.includes(i)) {
      lineCol = '0,0,128';
      barCol = '80,210,80';
    }
    if (!chartDataOk[i]) {
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
    borderColor: showMonth ? 'black' : 'rgba(0,0,0,0)',
    pointBackgroundColor: showMonth ? 'black' : 'rgba(0,0,0,0)',
    data: dataTariffAbove,
    borderWidth: 1,
    pointRadius: 0,
  }, {
    type: 'line',
    label: 'Trinn 2',
    borderColor: showMonth ? 'black' : 'rgba(0,0,0,0)',
    pointBackgroundColor: showMonth ? 'black' : 'rgba(0,0,0,0)',
    data: dataTariffBelow,
    borderWidth: 1,
    pointRadius: 0,
  }, {
    type: 'line',
    label: graphTariff,
    borderDash: [10, 5],
    borderColor: showMonth ? 'gray' : 'rgba(0,0,0,0)',
    pointBackgroundColor: showMonth ? 'gray' : 'rgba(0,0,0,0)',
    borderWidth: 1.5,
    pointRadius: 0,
    data: dataTariffGuide,
  }, {
    type: 'bar',
    label: chartPeriod === GRANULARITY.HOUR ? textConsumption : graphHighest,
    backgroundColor: colorBars,
    borderColor: colorBarLines,
    borderWidth: 1,
    data: dataset.map(x => Math.round(x)),
  }];
}

function generateHourlyMaxOptions(stats, graphTitle) {
  const dataset = stats.data.maxPower || [];
  chartDataOk = stats.dataGood || [];
  return {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        title: {
          display: true,
          text: graphYAxis,
        },
        ticks: {
          callback(value, index, ticks) {
            return (value / 1000).toFixed(2);
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
            return `${monthText[chartMonthIdx]} ${context[0].label}`;
          },
          beforeFooter(context) {
            if (!dataset[context[0].dataIndex]) return graphMissing;
            if (!chartDataOk[context[0].dataIndex]) return graphInaccurate;
            if ((context[0].dataIndex === dataset.length - 1)
              && (chartPeriod !== GRANULARITY.HOUR)
              && (now > chartStartTime)
              && (now < chartEndTime)) {
              return graphIncomplete;
            }
            return '';
          },
        },
        filter(context) {
          if (context.dataset.label.startsWith('Trinn')) return false;
          //if (context.dataset.label === graphTariff && chartPeriod != GRANULARITY.DAY) return false;
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
  let ppDirtMax = dataset.filter((p, i) => (+chartAux[i] === PP.DIRTCHEAP)).reduce((a, b) => { return a === undefined ? b : Math.max(a, b); }, undefined) || 0;
  const ppLowMax = dataset.filter((p, i) => (+chartAux[i] === PP.LOW)).reduce((a, b) => { return a === undefined ? b : Math.max(a, b); }, ppDirtMax);
  const ppNormMax = dataset.filter((p, i) => (+chartAux[i] === PP.NORM)).reduce((a, b) => { return a === undefined ? b : Math.max(a, b); }, ppLowMax);
  const ppHighMax = dataset.filter((p, i) => (+chartAux[i] === PP.HIGH)).reduce((a, b) => { return a === undefined ? b : Math.max(a, b); }, ppNormMax);
  const ppExtremeMax = dataset.filter((p, i) => (+chartAux[i] === PP.EXTREME)).reduce((a, b) => { return a === undefined ? b : Math.max(a, b); }, ppHighMax);
  const colDirt = 'rgba(0,255,0,0.5)';
  const colCheap = 'rgba(0,128,0,0.5)';
  const colNorm = 'rgba(0,128,255,0.4)';
  const colHigh = 'rgba(128,0,0,0.3)';
  const colExtreme = 'rgba(255,0,0,0.2)';
  if (!ppDirtMax) ppDirtMax = ppLowMax * 0.9;
  const skipped = (ctx, value) => ctx.p0.skip || ctx.p1.skip ? value : undefined;
  const chartData = [{
    type: 'line',
    stepped: perHour,
    tension: 0.4,
    fill: true,
    label: 'Dirt Cheap limit',
    borderColor: colDirt,
    backgroundColor: colDirt,
    pointBackgroundColor: colDirt,
    data: dataset.map((x, idx) => (x ? (perHour ? Math.min(x, ppDirtMax) : (x * (perDayCount[idx] ? chartAux[idx][4] / perDayCount[idx] : 1))) : undefined)),
    borderWidth: 1,
    pointRadius: 0,
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
    data: dataset.map((x, idx) => (x ? (perHour ? Math.min(x, ppLowMax) : (x * (perDayCount[idx] ? (chartAux[idx][4] + chartAux[idx][0]) / perDayCount[idx] : 1))) : undefined)),
    borderWidth: 1,
    pointRadius: 0,
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
    data: dataset.map((x, idx) => (x ? (perHour ? Math.min(x, ppNormMax) : (x * (perDayCount[idx] ? (chartAux[idx][4] + chartAux[idx][0] + chartAux[idx][1]) / perDayCount[idx] : 1))) : undefined)),
    borderWidth: 1,
    pointRadius: 0,
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
    data: dataset.map((x, idx) => (x ? (perHour ? Math.min(x, ppHighMax) : (x * (perDayCount[idx] ? (chartAux[idx][4] + chartAux[idx][0] + chartAux[idx][1] + chartAux[idx][2]) / perDayCount[idx] : 1))) : undefined)),
    borderWidth: 1,
    pointRadius: 0,
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
    data: dataset.map(x => (x ? (perHour ? Math.min(x, ppExtremeMax) : x) : undefined)),
    borderWidth: 1,
    pointRadius: 0,
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
      borderColor: ctx => skipped(ctx, 'rgb(0,0,0,0.6)'),
      backgroundColor: ctx => skipped(ctx, 'rgb(0,0,0,0.2'),
      borderDash: ctx => skipped(ctx, [6, 6]),
    },
  }];
  return chartData;
}

function generatePriceOptions(stats, graphTitle) {
  chartDataOk = stats.dataGood || [];
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
            const dataOkText = (context[0] && chartDataOk[context[0].dataIndex]) ? '' : `\n${graphInaccurate}`;
            if (+chartPeriod === GRANULARITY.HOUR) {
              let ppName;
              try {
                ppName = `${pricePoints.filter(i => (i.value === chartAux[context[0].dataIndex]))[0].name}${dataOkText}`;
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
              + `  ${pricePoints[0].name}: ${dayData[pricePoints[0].value]} ${hoursText}\n`
              + `  ${pricePoints[1].name}: ${dayData[pricePoints[1].value]} ${hoursText}\n`
              + `  ${pricePoints[2].name}: ${dayData[pricePoints[2].value]} ${hoursText}\n`
              + `  ${pricePoints[3].name}: ${dayData[pricePoints[3].value]} ${hoursText}\n`
              + `  ${pricePoints[4].name}: ${dayData[pricePoints[4].value]} ${hoursText}${dataOkText}`;
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
      chartHeader = textMaxHour;
      graphTypeRequest = 'maxPower'; // overShootAvoided
      break;
    case GRAPH_DATA_CONSUMPTION:
      chartHeader = textConsumption;
      graphTypeRequest = 'powUsage';
      break;
    case GRAPH_DATA_PRICES:
      chartHeader = textPrices;
      graphTypeRequest = '[price,pricePoints]'; // pricePoints
      break;
    case GRAPH_DATA_SAVINGS:
      chartHeader = textSavings;
      graphTypeRequest = '[moneySavedTariff,moneySavedUsage]';
      break;
  }
  Homey.api('GET', `/getStats?type=${graphTypeRequest}&time=${chartTime.getTime()}&granularity=${chartPeriod}`, null,
    (err, res) => {
      if (err) return alertUser(Homey, err);
      chartMonthIdx = res.localMonth;
      chartYearIdx = res.localYear;
      chartDayIdx = res.localDay;
      chartDaysInMonth = res.daysInMonth;
      chartHoursInDay = res.hoursInDay;
      chartTime = new Date(res.localTime);
      let timeString;
      let labels;
      switch (chartPeriod) {
        case GRANULARITY.MONTH:
          timeString = `${chartYearIdx}`;
          labels = monthText;
          chartStartTime = new Date(`${chartYearIdx}`);
          chartEndTime = new Date(chartStartTime.getTime() + (1000 * 60 * 60 * 24 * 365));
          break;
        case GRANULARITY.DAY:
          timeString = monthText[chartMonthIdx];
          labels = Array.from(Array(chartDaysInMonth + 1).keys()).slice(1);
          chartStartTime = new Date(`${chartYearIdx}-${chartMonthIdx+1}`);
          chartEndTime = new Date(chartStartTime.getTime() + (1000 * 60 * 60 * 24 * chartDaysInMonth));
          break;
        case GRANULARITY.HOUR:
          timeString = `${monthText[chartMonthIdx]} - ${chartDayIdx}`;
          labels = Array.from(Array(chartHoursInDay).keys()).map(h => `${h}:00`);
          chartStartTime = new Date(`${chartYearIdx}-${chartMonthIdx+1}-${chartDayIdx}`);
          chartEndTime = new Date(chartStartTime.getTime() + (1000 * 60 * 60 * chartHoursInDay));
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

function InitGraph(Homey, stats) {
  // Translate strings
  textMaxHour = Homey.__(textMaxHour);
  textConsumption = Homey.__(textConsumption);
  textPrices = Homey.__(textPrices);
  textSavings = Homey.__(textSavings);

  // Remember Chart latent state
  chartMonthIdx = stats.localMonth;
  chartDaysInMonth = stats.daysInMonth;
  chartHoursInDay = stats.hoursInDay;
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
    updateGraph(Homey);
    document.getElementById('tariffGuideChart').style.display = 'block';
  } else {
    chartId.options.plugins.title.text = 'new title';
  }
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
