/* eslint-disable no-nested-ternary */

'use strict';

// Constants
const GRAPH_DATA_CONSUMPTION = 0;
const GRAPH_DATA_PRICES = 1;
const GRAPH_DATA_SAVINGS = 2;

// Graphs
let chartId;
let chartContent = GRAPH_DATA_CONSUMPTION;
let chartPeriod = GRANULARITY.DAY;
let chartYearIdx = 2022;
let chartMonthIdx = 0;
let chartDayIdx = 0;
let chartDaysInMonth = 31;
let chartHoursInDay = 24;
let chartTime = new Date();
let chartAux;

// Translation text
let textConsumption = 'graph.consumption';
let textPrices = 'graph.prices';
let textSavings = 'graph.savings';

function generateHourlyMaxData(stats) {
  // Calculate values
  const dataset = stats.data.maxPower || [];
  const datasetOk = stats.dataGood || [];
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
  for (let i = 0; i < chartDaysInMonth; i++) {
    let barCol = '80,160,80';
    let barAlpha = 1;
    let lineCol = '0,0,0';
    let lineAlpha = 1;
    if (maxDays.includes(i)) {
      lineCol = '0,0,128';
      barCol = '80,210,80';
    }
    if (!datasetOk[i]) {
      barCol = '170,80,80';
    }
    if (i === dataset.length - 1) {
      barAlpha = 0.3;
      lineAlpha = 0.3;
    }
    colorBars[i] = `rgb(${barCol},${barAlpha})`;
    colorBarLines[i] = `rgb(${lineCol},${lineAlpha})`;
  }
  return [{
    type: 'line',
    label: 'Trinn 3',
    borderColor: 'black',
    pointBackgroundColor: 'black',
    data: dataTariffAbove,
    borderWidth: 1,
    pointRadius: 0,
  }, {
    type: 'line',
    label: 'Trinn 2',
    borderColor: 'black',
    pointBackgroundColor: 'black',
    data: dataTariffBelow,
    borderWidth: 1,
    pointRadius: 0,
  }, {
    type: 'line',
    label: graphTariff,
    borderDash: [10, 5],
    borderColor: 'gray',
    pointBackgroundColor: 'gray',
    borderWidth: 1.5,
    pointRadius: 0,
    data: dataTariffGuide,
  }, {
    type: 'bar',
    label: graphHighest,
    backgroundColor: colorBars,
    borderColor: colorBarLines,
    borderWidth: 1,
    data: dataset.map(x => Math.round(x)),
  }];
}

function generateHourlyMaxOptions(stats, graphTitle) {
  const dataset = stats.data.maxPower || [];
  const datasetOk = stats.dataGood || [];
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
            return `${Math.round(value / 100) / 10}`;
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
            if (datasetOk[context[0].dataIndex] !== true) return graphInaccurate;
            if (context[0].dataIndex === dataset.length - 1) return graphIncomplete;
            return '';
          },
        },
        filter(context) {
          if (context.dataset.label.startsWith('Trinn')) return false;
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
  const dataset = stats.data.price || [];
  chartAux = stats.data.pricePoints || []; // 0: PP_LOW, 1: PP_NORM, 2: PP_HIGH, 3: PP_EXTREME, 4: PP_DIRTCHEAP
  const ppDirtMax = dataset.filter((p, i) => (+chartAux[i] === PP.DIRTCHEAP)).reduce((a, b) => { return a === undefined ? b : Math.max(a, b); }, undefined) || 0;
  const ppLowMax = dataset.filter((p, i) => (+chartAux[i] === PP.LOW)).reduce((a, b) => { return a === undefined ? b : Math.max(a, b); }, ppDirtMax);
  const ppNormMax = dataset.filter((p, i) => (+chartAux[i] === PP.NORM)).reduce((a, b) => { return a === undefined ? b : Math.max(a, b); }, ppLowMax);
  const ppHighMax = dataset.filter((p, i) => (+chartAux[i] === PP.HIGH)).reduce((a, b) => { return a === undefined ? b : Math.max(a, b); }, ppNormMax);
  const ppExtremeMax = dataset.filter((p, i) => (+chartAux[i] === PP.EXTREME)).reduce((a, b) => { return a === undefined ? b : Math.max(a, b); }, ppHighMax);
  const colDirt = 'rgba(0,255,0,0.5)';
  const colCheap = 'rgba(0,128,0,0.5)';
  const colNorm = 'rgba(0,128,255,0.4)';
  const colHigh = 'rgba(128,0,0,0.3)';
  const colExtreme = 'rgba(255,0,0,0.2)';
  const stepped = (chartPeriod === GRANULARITY.HOUR);
  const chartData = [{
    type: 'line',
    stepped,
    tension: 0.4,
    fill: true,
    label: 'Dirt Cheap limit',
    borderColor: colDirt,
    backgroundColor: colDirt,
    pointBackgroundColor: colDirt,
    data: dataset.map((x, idx) => (stepped ? Math.min(x, ppDirtMax) : (x * chartAux[idx][4]) / chartAux[idx].reduce((a, b) => a + b, 0))),
    borderWidth: 1,
    pointRadius: 0,
  },
  {
    type: 'line',
    stepped,
    tension: 0.4,
    fill: true,
    label: 'Cheap limit',
    borderColor: colCheap,
    backgroundColor: colCheap,
    pointBackgroundColor: colCheap,
    data: dataset.map(x => (stepped ? Math.min(x, ppLowMax) : (x * (chartAux[idx][4] + chartAux[idx][0])) / chartAux[idx].reduce((a, b) => a + b, 0))),
    borderWidth: 1,
    pointRadius: 0,
  },
  {
    type: 'line',
    stepped,
    tension: 0.4,
    fill: true,
    label: 'Normal limit',
    borderColor: colNorm,
    backgroundColor: colNorm,
    pointBackgroundColor: colNorm,
    data: dataset.map(x => (stepped ? Math.min(x, ppNormMax) : (x * (chartAux[idx][4] + chartAux[idx][0] + chartAux[idx][1])) / chartAux[idx].reduce((a, b) => a + b, 0))),
    borderWidth: 1,
    pointRadius: 0,
  },
  {
    type: 'line',
    stepped,
    tension: 0.4,
    fill: true,
    label: 'Expensive limit',
    borderColor: colHigh,
    backgroundColor: colHigh,
    pointBackgroundColor: colHigh,
    data: dataset.map(x => (stepped ? Math.min(x, ppHighMax) : (x * (chartAux[idx][4] + chartAux[idx][0] + chartAux[idx][1] + chartAux[idx][2])) / chartAux[idx].reduce((a, b) => a + b, 0))),
    borderWidth: 1,
    pointRadius: 0,
  },
  {
    type: 'line',
    stepped,
    tension: 0.4,
    fill: true,
    label: 'Very Expensive limit',
    borderColor: colExtreme,
    backgroundColor: colExtreme,
    pointBackgroundColor: colExtreme,
    data: dataset.map(x => (stepped ? Math.min(x, ppExtremeMax) : x)),
    borderWidth: 1,
    pointRadius: 0,
  },
  {
    type: 'line',
    stepped,
    tension: 0.4,
    label: chargePlanGraphPrice,
    visible: true,
    borderColor: 'black',
    pointBackgroundColor: 'black',
    data: dataset.map(x => x),
    borderWidth: 1,
    pointRadius: 0,
  }];
  return chartData;
}

function generatePriceOptions(stats, graphTitle) {
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
            return `${graphTitle} - ${context[0].label}`;
          },
          beforeFooter(context) {
            let ppName;
            try {
              ppName = pricePoints.filter(i => (i.value === chartAux[context[0].dataIndex]))[0].name;
            } catch (err) {
              ppName = 'Unavailable';
            }
            if (+chartPeriod === GRANULARITY.HOUR) {
              return `Price point is ${ppName}`;
            }
            let dayData = chartAux[context[0].dataIndex];
            if (!Array.isArray(dayData)) return 'Price distribution was unavailable';
            return 'Price distribution was:\n'
              + `  ${pricePoints[0].name}: ${dayData[pricePoints[0].value]} hours\n`
              + `  ${pricePoints[1].name}: ${dayData[pricePoints[1].value]} hours\n`
              + `  ${pricePoints[2].name}: ${dayData[pricePoints[2].value]} hours\n`
              + `  ${pricePoints[3].name}: ${dayData[pricePoints[3].value]} hours\n`
              + `  ${pricePoints[4].name}: ${dayData[pricePoints[4].value]} hours\n`;
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
    case GRAPH_DATA_CONSUMPTION:
      chartHeader = textConsumption;
      graphTypeRequest = 'maxPower'; // powUsage, overShootAvoided
      break;
    case GRAPH_DATA_PRICES:
      chartHeader = textPrices;
      graphTypeRequest = '[price,pricePoints]'; // pricePoints
      break;
    case GRAPH_DATA_SAVINGS:
      chartHeader = textSavings;
      graphTypeRequest = 'moneySavedTariff'; // moneySavedUsage
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
          break;
        case GRANULARITY.DAY:
          timeString = monthText[chartMonthIdx];
          labels = Array.from(Array(chartDaysInMonth + 1).keys()).slice(1);
          break;
        case GRANULARITY.HOUR:
          timeString = `${monthText[chartMonthIdx]} - ${chartDayIdx + 1}`;
          labels = Array.from(Array(chartHoursInDay).keys()).map(h => `${h}:00`);
          break;
        default:
      }
      chartId.data.labels = labels;
      const graphTitle = `${chartHeader} - ${timeString}`;
      switch (chartContent) {
        case GRAPH_DATA_CONSUMPTION:
          chartId.data.datasets = generateHourlyMaxData(res);
          chartId.options = generateHourlyMaxOptions(res, graphTitle);
          break;
        case GRAPH_DATA_PRICES:
          chartId.data.datasets = generatePriceData(res);
          chartId.options = generatePriceOptions(res, graphTitle);
          break;
        case GRAPH_DATA_SAVINGS:
          break;
        default:
      }
      // Homey.api('GET', `/apiCommand?cmd=log&text=atdetvarat${timeString}&loglevel=0`, null, function (err2, result) {});
      return chartId.update();
    });
}

function onShowConsumptionGraph(Homey) {
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
  textConsumption = Homey.__(textConsumption);
  textPrices = Homey.__(textPrices);
  textSavings = Homey.__(textSavings);

  // Remember Chart latent state
  chartMonthIdx = stats.localMonth;
  chartDaysInMonth = stats.daysInMonth;
  chartHoursInDay = stats.hoursInDay;
  chartTime = new Date(stats.localTime);

  // Generate labels
  const dataDays = Array.from(Array(chartDaysInMonth + 1).keys()).slice(1);

  if (chartId === undefined) {
    chartId = new Chart('tariffGuideChart', {
      labels: dataDays,
      data: generateHourlyMaxData(stats),
      options: generateHourlyMaxOptions(stats, graphTitle),
    });
    document.getElementById('tariffGuideChart').style.display = 'block';
  } else {
    chartId.options.plugins.title.text = 'new title';
  }
}

module.exports = {
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
