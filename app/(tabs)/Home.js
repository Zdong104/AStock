import React, { useState } from 'react';
import { View, Text, Button, FlatList, TouchableOpacity, StyleSheet, ScrollView, TextInput, Modal} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import axios from 'axios';
import * as PortfolioAllocation from 'portfolio-allocation';
import Icon from 'react-native-vector-icons/Ionicons';

const stocks = ['aapl',
'amd',
'amzn',
'f',
'goog',
'gs',
'intc',
'ko',
'meta',
'msft',
'nflx',
'nvda',    
'tsla',
'v',]

const App = () => {
  const [selectedStocks, setSelectedStocks] = useState([]);
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [results, setResults] = useState(null);
  const [riskFreeRate, setRiskFreeRate] = useState(0);
  const [totalAmount, setTotalAmount] = useState(1000000);


  const toggleStockSelection = (stock) => {
    setSelectedStocks((prevSelected) =>
      prevSelected.includes(stock)
        ? prevSelected.filter((item) => item !== stock)
        : [...prevSelected, stock]
    );
  };

  const fetchDataAndRunModel = async () => {
    setSelectedStocks([]);
    setResults(null);
    console.log('\n\nSelected Stocks: ', selectedStocks)
    try {
      const stockData = await fetchStockData(selectedStocks, startDate, endDate);
      console.log('\n\nStockData:', stockData)
      const modelResults = runModel(stockData);
      setResults(modelResults);
    } catch (error) {
      console.error('Error fetching data or running model:', error);
    }
  };
  

  const fetchStockData = async (tickers, start, end) => {
    const formatDate = (date) => {
      return date.toISOString().split('T')[0];
    };

    const fetchTickerData = async (ticker) => {
      const url = `https://query1.finance.yahoo.com/v7/finance/download/${ticker}?period1=${Math.floor(new Date(startDate).getTime() / 1000)}&period2=${Math.floor(new Date(endDate).getTime() / 1000)}&interval=1d&events=history`;
      const response = await axios.get(url);
      console.log('\n Catched data from Server\n:',response,'\n\n')
      const rows = response.data.split('\n').slice(1);
      const formattedRows = rows.map(row => {
        const [date, , , , , adj_close,] = row.split(',');
        return { date, tic: ticker, adj_close: parseFloat(adj_close) };
      });
      console.log('\nFetched Data for', ticker, ':', formattedRows,'\n\n'); // Log the fetched data
      return formattedRows;
    };
    

    const promises = tickers.map(ticker => fetchTickerData(ticker));
    const results = await Promise.all(promises);
    return results.flat();
  };

  const runModel = (data) => {

    const processDfForMvo = (df) => {
      const stockDimension = df.length / selectedStocks.length;
      df.sort((a, b) => (a.date > b.date ? 1 : -1));
    
      let tic = [...new Set(df.map((item) => item.tic))];
      let mvo = {};
    
      tic.forEach((t) => {
        mvo[t] = [];
      });
    
      for (let i = 0; i < df.length; i++) {
        mvo[df[i].tic].push(df[i].adj_close);
      }
    
      let dates = [...new Set(df.map((item) => item.date))];
      let result = dates.map((date) => {
        let row = { date: date };
        tic.forEach((t) => {
          let index = df.findIndex((item) => item.date === date && item.tic === t);
          row[t] = index !== -1 ? df[index].adj_close : 0;
        });
        return row;
      });
      return result;
    };
    

    const stockReturnsComputing = (stockPrices) => {
      const rows = stockPrices.length;
      const cols = stockPrices[0].length; // Number of assets
      let stockReturn = Array(rows - 1)
        .fill()
        .map(() => Array(cols).fill(0));
    
      for (let j = 0; j < cols; j++) { // j: Assets
        for (let i = 0; i < rows - 1; i++) { // i: Daily Prices
          let prevPrice = stockPrices[i][j];
          let currPrice = stockPrices[i + 1][j];
          stockReturn[i][j] = ((currPrice - prevPrice) / prevPrice) * 100;
        }
      }
    
      return stockReturn;
    };
    

    const calculateMeanReturns = (arReturns) => {
      const rows = arReturns.length;
      const cols = arReturns[0].length;
    
      let meanReturns = Array(cols).fill(0);
      
      for (let j = 0; j < cols; j++) { // Loop through columns (assets)
        for (let i = 0; i < rows; i++) { // Loop through rows (daily returns)
          meanReturns[j] += arReturns[i][j];
        }
        meanReturns[j] /= rows; // Divide by the number of rows to get the mean
      }
    
      return meanReturns;
    };
    

    const calculateCovarianceMatrix = (returns, meanReturns) => {
      const rows = returns.length;
      const cols = returns[0].length;
      let covarianceMatrix = Array(cols)
        .fill()
        .map(() => Array(cols).fill(0));

      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < cols; j++) {
          let cov = 0;
          for (let k = 0; k < rows; k++) {
            cov += (returns[k][i] - meanReturns[i]) * (returns[k][j] - meanReturns[j]);
          }
          covarianceMatrix[i][j] = cov / (rows - 1);
        }
      }

      return covarianceMatrix;
    };



    const calculateMaxSharpe = (meanReturns, covReturns) => {
      const nbPortfolios = 100; // Number of portfolios to generate on the efficient frontier
      const portfolios = PortfolioAllocation.meanVarianceEfficientFrontierPortfolios(meanReturns, covReturns, {
        nbPortfolios: nbPortfolios,
        discretizationType: 'return', // Generate portfolios based on return
      });

      // Find the portfolio with the maximum Sharpe Ratio
      const riskFreeRate = 0; // Risk-free rate, adjust as needed
      let maxSharpeRatio = -Infinity;
      let maxSharpeWeights = [];

      portfolios.forEach(([weights, portfolioReturn, portfolioVolatility]) => {
        const sharpeRatio = (portfolioReturn - riskFreeRate) / portfolioVolatility;
        if (sharpeRatio > maxSharpeRatio) {
          maxSharpeRatio = sharpeRatio;
          maxSharpeWeights = weights;
        }
      });

      const scaledWeights = maxSharpeWeights.map(weight => weight * totalAmount);

      return scaledWeights;
    };


    const calculateERC = (covReturns) => {
      const ercWeights = PortfolioAllocation.equalRiskContributionWeights(covReturns);

      const scaledWeights = ercWeights.map(weight => weight * totalAmount);

      return scaledWeights;
    };



    const stockData = processDfForMvo(data);
    console.log('First Step Process',stockData,'\n\n\n\n\n\n\n')
    const arStockPrices = stockData.map((row) => Object.values(row).slice(1)); // Exclude date column
    console.log('\n\n arStockPrices:', arStockPrices)
    const [rows, cols] = [arStockPrices.length, arStockPrices[0].length];

    const arReturns = stockReturnsComputing(arStockPrices); //arReturns is Asset return in 100% scale
    console.log('\n\n arReturns:', arReturns)


    const meanReturns = calculateMeanReturns(arReturns) // still in 100%
    console.log('\n\n meanReturns:', meanReturns)


    
    const covReturns = calculateCovarianceMatrix(arReturns, meanReturns); // Calculate the Covariance value
    console.log('Con Variance Value: ',covReturns)

    
    // Compute the maximum Sharpe ratio portfolio weights
    const maxSharpeWeights = calculateMaxSharpe(meanReturns, covReturns);
    console.log('Max Sharpe Weights: ', maxSharpeWeights);

    const ercWeights = calculateERC(covReturns); // Implement ERC calculation
    console.log('ERC Weights: ', ercWeights);

    return { meanReturns, covReturns, maxSharpeWeights, ercWeights };
  };

  // Below just display and the visualization
  const onChangeStart = (event, selectedDate) => {
    const currentDate = selectedDate || startDate;
    setShowStartPicker(false);
    setStartDate(currentDate);
  };

  const onChangeEnd = (event, selectedDate) => {
    const currentDate = selectedDate || endDate;
    setShowEndPicker(false);
    setEndDate(currentDate);
  };


  return (
    <ScrollView style={styles.container}>
      <Text style={styles.header}>Select Stocks:</Text>
      <FlatList
        data={stocks}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => toggleStockSelection(item)}>
            <Text
              style={[
                styles.stockItem,
                selectedStocks.includes(item) && styles.selectedStockItem,
              ]}
            >
              {item}
            </Text>
          </TouchableOpacity>
        )}
        keyExtractor={(item) => item}
      />
      <View style={styles.inputContainer}>
        <Text>Risk-Free Rate:</Text>
        <TextInput
          style={styles.input}
          value={String(riskFreeRate)}
          onChangeText={(text) => setRiskFreeRate(parseFloat(text))}
          keyboardType="numeric"
        />
      </View>
      <View style={styles.inputContainer}>
        <Text>Total Amount to Allocate:</Text>
        <TextInput
          style={styles.input}
          value={String(totalAmount)}
          onChangeText={(text) => setTotalAmount(parseFloat(text))}
          keyboardType="numeric"
        />
      </View>
      <View style={styles.datePicker}>
        <Button onPress={() => setShowStartPicker(true)} title="Select Start Date" />
        {showStartPicker && (
          <DateTimePicker
            value={startDate}
            mode="date"
            display="default"
            onChange={onChangeStart}
          />
        )}
        <Button onPress={() => setShowEndPicker(true)} title="Select End Date" />
        {showEndPicker && (
          <DateTimePicker
            value={endDate}
            mode="date"
            display="default"
            onChange={onChangeEnd}
          />
        )}
      </View>
      <Button title="Run Model" onPress={fetchDataAndRunModel} style={styles.runButton} />
      {results && (
        <View style={styles.resultsContainer}>
          <View style={styles.resultCard}>
            <View style={styles.resultHeaderContainer}>
              <Text style={styles.resultHeader}>Mean Returns %:</Text>
            </View>
            {results.meanReturns.map((returnVal, index) => (
              <Text key={stocks[index]} style={styles.resultContent}>
                {stocks[index]}: {returnVal.toFixed(4)}
              </Text>
            ))}
          </View>
          <View style={styles.resultCard}>
            <View style={styles.resultHeaderContainer}>
              <Text style={styles.resultHeader}>Max Sharpe Ratio Weights:</Text>
              </View>
            {results.maxSharpeWeights.map((weight, index) => (
              <Text key={stocks[index]} style={styles.resultContent}>
                {stocks[index]}: {weight.toFixed(2)}
              </Text>
            ))}
          </View>
          <View style={styles.resultCard}>
            <View style={styles.resultHeaderContainer}>
              <Text style={styles.resultHeader}>Equal Risk Contribution (ERC) Weights:</Text>
                </View>
                  

            {results.ercWeights.map((weight, index) => (
              <Text key={stocks[index]} style={styles.resultContent}>
                {stocks[index]}: {weight.toFixed(2)}
              </Text>
            ))}
          </View>


        </View>
      )}


    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop:30,
    padding: 20,
    backgroundColor: '#f0f0f0',
    flex: 1,
  },
  header: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  stockItem: {
    padding: 10,
    backgroundColor: 'grey',
    marginVertical: 5,
    color: 'white',
    textAlign: 'center',
    borderRadius: 5,
  },
  selectedStockItem: {
    backgroundColor: 'green',
  },
  inputContainer: {
    marginVertical: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 10,
    borderRadius: 5,
    backgroundColor: 'white',
  },
  datePicker: {
    marginVertical: 10,
  },
  runButton: {
    marginVertical: 20,
  },
  resultsContainer: {
    marginVertical:20,
  },
  resultCard: {
    backgroundColor: 'white',
    padding: 15,
    marginBottom: 10,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
  },
  resultHeader: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  resultContent: {
    fontSize: 14,
    marginTop: 5,
  },
  resultHeaderContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalBackground: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContainer: {
    width: '80%',
    padding: 20,
    backgroundColor: 'white',
    borderRadius: 10,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  modalContent: {
    fontSize: 16,
    marginBottom: 20,
  },
});

export default App;