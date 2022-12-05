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

function generateHourlyMaxOptions(stats) {
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

function generatePriceData() {
  // Calculate values
  const dataset = stats.data.price || [];
  /*const datasetOk = stats.dataGood || [];
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
  }*/
  return [{
    type: 'line',
    label: 'Price',
    borderColor: 'black',
    pointBackgroundColor: 'black',
    data: dataset.map(x => Math.round(x)),
    borderWidth: 1,
    pointRadius: 0,
  }/*, {
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
  }*/];
}

function generatePriceOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        title: {
          display: true,
          text: graphYAxis,
        },
/*        ticks: {
          callback(value, index, ticks) {
            return `${Math.round(value / 100) / 10}`;
          },
        },*/
      },
    },
    interaction: {
      intersect: false,
      mode: 'index',
    },
/*    plugins: {
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
    },*/
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
      graphTypeRequest = 'price'; // pricePoints
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
        case GRANULARITY.YEAR:
          timeString = `${chartYearIdx}`;
          labels = [2022];
          break;
        case GRANULARITY.MONTH:
          timeString = monthText[chartMonthIdx];
          labels = Array.from(Array(chartDaysInMonth + 1).keys()).slice(1);
          break;
        case GRANULARITY.DAY:
          timeString = `${monthText[chartMonthIdx]} - ${chartDayIdx + 1}`;
          labels = Array.from(Array(chartHoursInDay + 1).keys()).slice(1);
          break;
        default:
      }
      chartId.options.plugins.title.text = `${chartHeader} - ${timeString}`;
      chartId.data.labels = labels;
      /*switch (chartContent) {
        case GRAPH_DATA_CONSUMPTION:*/
          chartId.data.datasets = generateHourlyMaxData(res);
/*          chartId.data.options = generateHourlyMaxOptions(res);
          break;
        case GRAPH_DATA_PRICES:
          chartId.data.datasets = generatePriceData(res);
          chartId.data.options = generatePriceOptions(res);
          break;
        case GRAPH_DATA_SAVINGS:
          break;
        default:
      }*/
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
  chartPeriod = GRANULARITY.DAY;
  updateGraph(Homey);
}

function onShowMonthTimespan(Homey) {
  chartPeriod = GRANULARITY.MONTH;
  updateGraph(Homey);
}

function onShowYearTimespan(Homey) {
  chartPeriod = GRANULARITY.YEAR;
  updateGraph(Homey);
}

function onBackClick(Homey) {
  switch (chartPeriod) {
    case GRANULARITY.DAY:
      chartTime.setUTCDate(chartTime.getUTCDate() - 1);
      break;
    default:
    case GRANULARITY.MONTH:
      chartTime.setUTCMonth(chartTime.getUTCMonth() - 1);
      break;
    /* case GRAPH_PERIOD_WEEK:
      chartTime.setUTCDate(chartTime.getUTCDate() - 7);
      break; */
    case GRANULARITY.YEAR:
      chartTime.setUTCFullYear(chartTime.getUTCFullYear() - 1);
      break;
  }
  updateGraph(Homey);
}

function onForwardClick(Homey) {
  switch (chartPeriod) {
    case GRANULARITY.DAY:
      chartTime.setUTCDate(chartTime.getUTCDate() + 1);
      break;
    default:
    case GRANULARITY.MONTH:
      chartTime.setUTCMonth(chartTime.getUTCMonth() + 1);
      break;
    /* case GRAPH_PERIOD_WEEK:
      chartTime.setUTCDate(chartTime.getUTCDate() + 7);
      break; */
    case GRANULARITY.YEAR:
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
      options: generateHourlyMaxOptions(stats),
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
