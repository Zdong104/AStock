import { SafeAreaView } from 'react-native-safe-area-context';
import React, { useState } from 'react';
import { View, Text, Button, FlatList, TouchableOpacity, StyleSheet, ScrollView, TextInput } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import axios from 'axios';
import * as PortfolioAllocation from 'portfolio-allocation';
import Icon from 'react-native-vector-icons/Ionicons';

const stocks = ['sh600036', 'sz000001', 'sz300716', 'sz002593', 'sh600889', 'sh600567', 'sz000628', 'sz002131', 'sh603005', 'sz002199', 'sh603586', 'sz000010', 'sz002594'];

const App = () => {
  const [selectedStocks, setSelectedStocks] = useState([]);
  const tenDaysAgo = new Date();
  tenDaysAgo.setDate(tenDaysAgo.getDate() - 30);
  const [startDate, setStartDate] = useState(tenDaysAgo);
  const [endDate, setEndDate] = useState(new Date());
  const [results, setResults] = useState(null);
  const [riskFreeRate, setRiskFreeRate] = useState(0);
  const [totalAmount, setTotalAmount] = useState(1000000);
  const [searchTerm, setSearchTerm] = useState('');
  const [basket, setBasket] = useState([]);

  const toggleStockSelection = (stock) => {
    setSelectedStocks((prevSelected) =>
      prevSelected.includes(stock)
        ? prevSelected.filter((item) => item !== stock)
        : [...prevSelected, stock]
    );
  };

  const addToBasket = () => {
    const newStocks = selectedStocks.filter(stock => !basket.includes(stock));
    setBasket([...basket, ...newStocks]);
    setSelectedStocks([]);
  };
  

  const clearBasket = () => {
    setBasket([]);
  };

  const fetchDataAndRunModel = async () => {
    setResults(null);
    console.log('\n\nSelected Stocks: ', basket)
    try {
      const stockData = await fetchStockData(basket, startDate, endDate);
      console.log('\n\nStockData or All Data:', stockData)

      const modelResults = runModel(stockData);
      setResults(modelResults);
    } 
    catch (error) {
      console.error('Error fetching data or running model:', error);
    }
  };


  const fetchStockData = async (tickers, start, end, scale = 240) => {
    const formatDate = (date) => {
      return date.toISOString().split('T')[0];
    };
  
    const fetchTickerData = async (ticker) => {
      const startDate = formatDate(start);
      const endDate = formatDate(end);
      const startTime = new Date(startDate).getTime();
      const endTime = new Date(endDate).getTime();
      const DataLen = Math.ceil((endTime - startTime) / (1000 * 60 * 60 * 24)); // 计算天数差
  
      console.log(`Start Date: ${startDate}`);
      console.log(`End Date: ${endDate}`);
      console.log(`DataLen: ${DataLen}`);
  
      const timestamp = new Date().getTime();
      const url = `https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_${ticker}_${scale}_${timestamp}=/CN_MarketDataService.getKLineData?symbol=${ticker}&scale=${scale}&ma=no&datalen=${DataLen}`;
  
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch data for ticker ${ticker}`);
      }
  
      const blob = await response.blob();
  
      // Use FileReader to read the Blob content as text
      const reader = new FileReader();
      const textPromise = new Promise((resolve, reject) => {
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
      });
      reader.readAsText(blob, 'GBK'); // Specify the encoding
  
      const text = await textPromise;
      const jsonpData = text.match(/\((.*)\)/)[1]; // 提取JSONP数据
      const data = JSON.parse(jsonpData);
  
      // 提取 close 值并格式化数据
      const formattedData = data.map(item => ({
        date: item.day,
        tic: ticker,
        close: parseFloat(item.close)
      }));
      console.log('formattedData',formattedData)
  
      return formattedData;
    };
  
    const allData = await Promise.all(tickers.map(ticker => fetchTickerData(ticker)));
    return allData.flat();
  };

  const runModel = (data) => {
    const processDfForMvo = (df) => {
      df.sort((a, b) => (a.date > b.date ? 1 : -1));

      let tic = [...new Set(df.map((item) => item.tic))];
      let mvo = {};

      tic.forEach((t) => {
        mvo[t] = [];
      });

      for (let i = 0; i < df.length; i++) {
        mvo[df[i].tic].push(df[i].close);
      }

      let dates = [...new Set(df.map((item) => item.date))];
      let result = dates.map((date) => {
        let row = { date: date };
        tic.forEach((t) => {
          let index = df.findIndex((item) => item.date === date && item.tic === t);
          row[t] = index !== -1 ? df[index].close : 0;
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
        discretizatinType: 'return', // Generate portfolios based on return
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
    console.log('\n\n\nRun model: First Step Process', stockData)
    const arStockPrices = stockData.map((row) => Object.values(row).slice(1)); // Exclude date column
    console.log('\n\n arStockPrices:', arStockPrices)
    const [rows, cols] = [arStockPrices.length, arStockPrices[0].length];

    const arReturns = stockReturnsComputing(arStockPrices); //arReturns is Asset return in 100% scale
    console.log('\n\n arReturns:', arReturns)

    const meanReturns = calculateMeanReturns(arReturns) // still in 100%
    console.log('\n\n meanReturns:', meanReturns)

    const covReturns = calculateCovarianceMatrix(arReturns, meanReturns); // Calculate the Covariance value
    console.log('Con Variance Value: ', covReturns)

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
    setStartDate(currentDate);
  };

  const onChangeEnd = (event, selectedDate) => {
    const currentDate = selectedDate || endDate;
    setEndDate(currentDate);
  };

  const capitalize = (str) => str.toUpperCase();

  const filteredStocks = stocks.filter(stock => stock.toUpperCase().includes(searchTerm.toUpperCase()));

  return (
    <SafeAreaView style={styles.safeArea}>
    <FlatList
      style={styles.container}
      data={filteredStocks}
      keyExtractor={(item) => item}
      ListHeaderComponent={() => (
        <>
          <Text style={styles.header}>Search and Select Stocks:</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search stocks..."
            value={searchTerm}
            onChangeText={setSearchTerm}
          />
          
          {filteredStocks.reduce((rows, stock, index) => {
            if (index % 3 === 0) rows.push([]);
            rows[rows.length - 1].push(stock);
            return rows;
          }, []).map((row, rowIndex) => (
            <View key={rowIndex} style={styles.stockRow}>
              {row.map((stock) => (
                <TouchableOpacity key={stock} onPress={() => toggleStockSelection(stock)}>
                  <Text
                    style={[
                      styles.stockItem,
                      selectedStocks.includes(stock) && styles.selectedStockItem,
                    ]}
                  >
                    {capitalize(stock)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ))}


          <View style={styles.buttonContainer}>
          <TouchableOpacity style={styles.button} onPress={addToBasket}>
            <Text style={styles.buttonText}>Add to Basket</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.clearButton]} onPress={clearBasket}>
            <Text style={styles.buttonText}>Clear Basket</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.basketContainer}>
          <Text style={styles.basketHeader}>Basket:</Text>
          <View style={styles.basketItems}>
            {basket.map((stock, index) => (
              <Text key={index} style={styles.basketItem}>{capitalize(stock)}</Text>
            ))}
          </View>
        </View>
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
          <View style={styles.datePickerContainer}>
            <View style={styles.datePicker}>
              <Text style={styles.datePickerText}>Select Start Date</Text>
                <DateTimePicker
                  value={startDate}
                  mode="date"
                  display="default"
                  onChange={onChangeStart}
                />
            </View>
            <View style={styles.datePicker}>
              <Text style={styles.datePickerText}>Select End Date</Text>
                <DateTimePicker
                  value={endDate}
                  mode="date"
                  display="default"
                  onChange={onChangeEnd}
                />
            </View>
          </View>

          <Button title="Run Model" onPress={fetchDataAndRunModel} style={styles.runButton} />
        </>
      )}
      ListFooterComponent={() => (
        results && (
          <View style={styles.resultsContainer}>
            <View style={styles.resultCard}>
              <View style={styles.resultHeaderContainer}>
                <Text style={styles.resultHeader}>Mean Returns %:</Text>
              </View>
              {results.meanReturns.map((returnVal, index) => (
                <Text key={basket[index]} style={styles.resultContent}>
                {capitalize(basket[index])}: {returnVal.toFixed(4)}
                </Text>
              ))}
            </View>
            <View style={styles.resultCard}>
              <View style={styles.resultHeaderContainer}>
                <Text style={styles.resultHeader}>Max Sharpe Ratio Weights:</Text>
              </View>
              {results.maxSharpeWeights.map((weight, index) => (
                <Text key={basket[index]} style={styles.resultContent}>
                {capitalize(basket[index])}: {weight.toFixed(2)}
                </Text>
              ))}
            </View>
            <View style={styles.resultCard}>
              <View style={styles.resultHeaderContainer}>
                <Text style={styles.resultHeader}>Equal Risk Contribution (ERC) Weights:</Text>
              </View>
              {results.ercWeights.map((weight, index) => (
                <Text key={basket[index]} style={styles.resultContent}>
                {capitalize(basket[index])}: {weight.toFixed(2)}
                </Text>
              ))}
            </View>
          </View>
        )
      )}
    />
      </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f0f0f0',
  },
  container: {
    padding: 20,
    backgroundColor: '#f0f0f0',
    flex: 1,
  },
  header: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 10,
    borderRadius: 5,
    marginBottom: 20,
    backgroundColor: 'white',
  },
  stockRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 5,
  },
  stockItem: {
    width: '50', // Adjust width to fit 5 items per row
    height: 30,
    padding: 10,
    backgroundColor: 'grey',
    marginHorizontal: '1%', // Adjust margin to fit 5 items per row
    color: 'white',
    textAlign: 'center',
    borderRadius: 5,
    justifyContent: 'center',
    alignItems: 'center',
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
  datePickerContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 10,
  },
  datePicker: {
    marginVertical: 10,
  },
  runButton: {
    marginVertical: 20,
  },
  resultsContainer: {
    marginVertical: 20,
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
  basketContainer: {
    marginTop: 20,
    marginBottom: 20,
  },
  basketContainer: {
    marginTop: 20,
    marginBottom: 20,
  },
  basketHeader: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  basketItems: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
  },
  basketItem: {
    fontSize: 14,
    marginRight: 10,
    backgroundColor: '#e0e0e0',
    padding: 5,
    borderRadius: 5,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 10,
    backgroundColor: '#e0e0e0',
    padding: 10,
    borderRadius: 5,
  },
});

export default App;
