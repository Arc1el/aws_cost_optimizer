const fs = require('fs');
const util = require('util');
const AWS = require('aws-sdk');
const regions = {
  "Africa (Cape Town)": "af-south-1",
  "Asia Pacific (Hong Kong)": "ap-east-1",
  "Asia Pacific (Tokyo)": "ap-northeast-1",
  "Asia Pacific (Seoul)": "ap-northeast-2",
  "Asia Pacific (Osaka)": "ap-northeast-3",
  "Asia Pacific (Mumbai)": "ap-south-1",
  "Asia Pacific (Hyderabad)": "ap-south-2",
  "Asia Pacific (Singapore)": "ap-southeast-1",
  "Asia Pacific (Sydney)": "ap-southeast-2",
  "Asia Pacific (Jakarta)": "ap-southeast-3",
  "Asia Pacific (Melbourne)": "ap-southeast-4",
  "Canada (Central)": "ca-central-1",
  "EU (Frankfurt)": "eu-central-1",
  "EU (Zurich)": "eu-central-2",
  "EU (Stockholm)": "eu-north-1",
  "EU (Milan)": "eu-south-1",
  "EU (Spain)": "eu-south-2",
  "EU (Ireland)": "eu-west-1",
  "EU (London)": "eu-west-2",
  "EU (Paris)": "eu-west-3",
  "Middle East (UAE)": "me-central-1",
  "Middle East (Bahrain)": "me-south-1",
  "South America (Sao Paulo)": "sa-east-1",
  "US East (N. Virginia)": "us-east-1",
  "US East (Ohio)": "us-east-2",
  "US West (N. California)": "us-west-1",
  "US West (Oregon)": "us-west-2"
};

/*
rds types
Amazon RDS Custom for Oracle        rds-flex-oracle-calc
Amazon RDS Custom for SQL Server    rds-flex-sqlserver-calc
Amazon RDS for MariaDB              rds-mariadb-calc
Amazon RDS for MySQL                rds-mysql-calc
Amazon RDS for Oracle               rds-oracle-calc
Amazon RDS for PostgreSQL           rds-postgresql-calc
Amazon RDS for SQL server           rds-sqlserver-calc 

rds proxy price data
https://calculator.aws/pricing/2.0/meteredUnitMaps/rds/USD/current/rds-proxy.json

rds instance list
rds type, region
https://calculator.aws/pricing/2.0/meteredUnitMaps/rds/USD/current/rds-mysql-calc/Asia%20Pacific%20(Seoul)/primary-selector-aggregations.json

rds price
rds type, region, single|multi, instance type(type/vCPU/Memory), ondemand/ri 
https://calculator.aws/pricing/2.0/meteredUnitMaps/rds/USD/current/rds-mysql-calc/Asia%20Pacific%20(Seoul)/Single-AZ/db.m4.10xlarge/40/160%20GiB/OnDemand/index.json
*/
function logger(data, socket) {
  console.log(data); 
  socket.emit('console_logger', data); 
}

exports.opt = async function ({socket, data}){
  logger("rds start", socket);
  var region_seq = data.number;
  var id = data.role;

  const switchRegion = regions[Object.keys(regions)[region_seq]];
  AWS.config.update({ region: switchRegion });
  AWS.config.credentials = new AWS.TemporaryCredentials({
    RoleArn: `arn:aws:iam::${id}:role/Smileshark-sysadmin`, // Replace with your ARN role
  });


  const cloudwatch = new AWS.CloudWatch();
  const cloudwatchGetMetricWidgetImage = util.promisify(cloudwatch.getMetricWidgetImage.bind(cloudwatch));

  const saveChartImage = async (chartOptions, fileName) => {
    const widgetData = JSON.stringify(chartOptions);
    const params = {
      MetricWidget: widgetData,
      OutputFormat: 'png',
    };
  
    try {
      const imageResponse = await cloudwatchGetMetricWidgetImage(params);
      const imageData = imageResponse.MetricWidgetImage;
  
      // Save the image data to a file
      mkdir(`./rds_chart/${id}`)
      fs.writeFileSync(`./rds_chart/${id}/${fileName}`, imageData);
      console.log(`Chart image saved to ${fileName}`);
    } catch (error) {
      console.error('Error saving chart image:', error);
    }
  };

  try{ 
    // RDS 인스턴스 리스트 가져오기
    const getAllRDSInstances = async () => {
      const rds = new AWS.RDS();
      const instances = [];
    
      try {
        const response = await rds.describeDBInstances().promise();
        instances.push(...response.DBInstances);
      } catch (error) {
        throw error;
      }
    
      return instances;
    };
    
    // 모든 RDS 데이터 및 성능 정보 가져오기
    const getAllRDSData = async () => {
      try {
        const instances = await getAllRDSInstances();
        const allRDSData = [];
    
        for (const instance of instances) {
          const rdsData = {
            instance: {
              DBInstanceIdentifier: instance.DBInstanceIdentifier,
              Engine: instance.Engine,
              DBInstanceClass: instance.DBInstanceClass,
              EngineVersion: instance.EngineVersion,
              AvailabilityZone: instance.AvailabilityZone
            },
            maxCPUUsage: 0,
            maxMemoryUsage: 0,
            maxWriteLatency: 0,
            maxReadLatency: 0
          };
    
          // 최대 CPU 사용률 조회
          const cloudwatch = new AWS.CloudWatch();
          const cpuMetricParams = {
            MetricName: 'CPUUtilization',
            Namespace: 'AWS/RDS',
            Dimensions: [
              {
                Name: 'DBInstanceIdentifier',
                Value: instance.DBInstanceIdentifier
              }
            ],
            StartTime: new Date(Date.now() - 1209600000), // 2주간 데이터 조회
            EndTime: new Date(),
            Period: 3600, // 조회 주기 (1시간)
            Statistics: ['Maximum'] // 최대값 조회
          };
    
          const cpuMetricData = await cloudwatch.getMetricStatistics(cpuMetricParams).promise();
          rdsData.maxCPUUsage = getMaxMetricValue(cpuMetricData.Datapoints, 'Maximum');

          const cpuChartOptions = {
            width: 600,
            height: 400,
            start: '-P2W',
            end: 'P0D',
            period: 3600,
            title: `CPU Utilization (${instance.DBInstanceIdentifier})`,
            yAxis: {
              left: {
                min: 0,
                max: 100,
              },
            },
            view: 'timeSeries',
            stacked: false,
            metrics: [
              [
                'AWS/RDS',
                'CPUUtilization',
                'DBInstanceIdentifier',
                instance.DBInstanceIdentifier,
                { id: 'm1', label: 'Maximum', visible: true, stat: 'Maximum' },
              ],
            ],
          };
          await saveChartImage(cpuChartOptions, `cpu_chart_${instance.DBInstanceIdentifier}.png`);
    
          // 최대 메모리 사용률 조회
          const memoryMetricParams = {
            MetricName: 'FreeableMemory',
            Namespace: 'AWS/RDS',
            Dimensions: [
              {
                Name: 'DBInstanceIdentifier',
                Value: instance.DBInstanceIdentifier
              }
            ],
            StartTime: new Date(Date.now() - 1209600000), // 2주간 데이터 조회
            EndTime: new Date(),
            Period: 3600, // 조회 주기 (1시간)
            Statistics: ['Maximum'] // 최대값 조회
          };
    
          const memoryMetricData = await cloudwatch.getMetricStatistics(memoryMetricParams).promise();
          rdsData.maxMemoryUsage = getMaxMetricValue(memoryMetricData.Datapoints, 'Maximum');

          // Generate and save memory chart image
          const memoryChartOptions = {
            width: 600,
            height: 400,
            start: '-P2W',
            end: 'P0D',
            period: 3600,
            title: `Memory Usage (${instance.DBInstanceIdentifier})`,
            yAxis: {
              left: {
                min: 0,
              },
            },
            view: 'timeSeries',
            stacked: false,
            metrics: [
              [
                'AWS/RDS',
                'FreeableMemory',
                'DBInstanceIdentifier',
                instance.DBInstanceIdentifier,
                { id: 'm1', label: 'Maximum', visible: true, stat: 'Maximum' },
              ],
            ],
          };
          await saveChartImage(memoryChartOptions, `memory_chart_${instance.DBInstanceIdentifier}.png`);

          // 최대 쓰기 지연 시간 조회
          const writeLatencyMetricParams = {
            MetricName: 'WriteLatency',
            Namespace: 'AWS/RDS',
            Dimensions: [
              {
                Name: 'DBInstanceIdentifier',
                Value: instance.DBInstanceIdentifier
              }
            ],
            StartTime: new Date(Date.now() - 1209600000), // 2주간 데이터 조회
            EndTime: new Date(),
            Period: 3600, // 조회 주기 (1시간)
            Statistics: ['Maximum'] // 최대값 조회
          };
    
          const writeLatencyMetricData = await cloudwatch.getMetricStatistics(writeLatencyMetricParams).promise();
          rdsData.maxWriteLatency = getMaxMetricValue(writeLatencyMetricData.Datapoints, 'Maximum');
          // Generate and save write latency chart image
          const writeLatencyChartOptions = {
            width: 600,
            height: 400,
            start: '-P2W',
            end: 'P0D',
            period: 3600,
            title: `Write Latency (${instance.DBInstanceIdentifier})`,
            yAxis: {
              left: {
                min: 0,
              },
            },
            view: 'timeSeries',
            stacked: false,
            metrics: [
              [
                'AWS/RDS',
                'WriteLatency',
                'DBInstanceIdentifier',
                instance.DBInstanceIdentifier,
                { id: 'm1', label: 'Maximum', visible: true, stat: 'Maximum' },
              ],
            ],
          };
          await saveChartImage(writeLatencyChartOptions, `write_latency_chart_${instance.DBInstanceIdentifier}.png`);

          // 최대 읽기 지연 시간 조회
          const readLatencyMetricParams = {
            MetricName: 'ReadLatency',
            Namespace: 'AWS/RDS',
            Dimensions: [
              {
                Name: 'DBInstanceIdentifier',
                Value: instance.DBInstanceIdentifier
              }
            ],
            StartTime: new Date(Date.now() - 1209600000), // 2주간 데이터 조회
            EndTime: new Date(),
            Period: 3600, // 조회 주기 (1시간)
            Statistics: ['Maximum'] // 최대값 조회
          };
    
          const readLatencyMetricData = await cloudwatch.getMetricStatistics(readLatencyMetricParams).promise();
          rdsData.maxReadLatency = getMaxMetricValue(readLatencyMetricData.Datapoints, 'Maximum');

          // Generate and save read latency chart image
          const readLatencyChartOptions = {
            width: 600,
            height: 400,
            start: '-P2W',
            end: 'P0D',
            period: 3600,
            title: `Read Latency (${instance.DBInstanceIdentifier})`,
            yAxis: {
              left: {
                min: 0,
              },
            },
            view: 'timeSeries',
            stacked: false,
            metrics: [
              [
                'AWS/RDS',
                'ReadLatency',
                'DBInstanceIdentifier',
                instance.DBInstanceIdentifier,
                { id: 'm1', label: 'Maximum', visible: true, stat: 'Maximum' },
              ],
            ],
          };
          await saveChartImage(readLatencyChartOptions, `read_latency_chart_${instance.DBInstanceIdentifier}.png`);

    
          allRDSData.push(rdsData);
        }
    
        return allRDSData;
      } catch (error) {
        throw error;
      }
    };
    
    // 최대 메트릭 값을 찾는 함수
    const getMaxMetricValue = (datapoints, statistic) => {
      let maxValue = 0;
    
      for (const datapoint of datapoints) {
        const value = datapoint[statistic];
        if (value > maxValue) {
          maxValue = value;
        }
      }
    
      return maxValue;
    };
    
    // 모든 RDS 데이터 및 성능 정보 가져오기 실행
    getAllRDSData()
      .then(data => {
        console.log('모든 RDS 데이터 및 성능 정보:', data);
    
        // 2주간 최대 CPU, 메모리, 읽기/쓰기 지연 시간 정보를 JSON 형식으로 출력
        const jsonData = JSON.stringify(data, null, 2);
        console.log('2주간 최대 성능 정보(JSON):\n', jsonData);
        logger(jsonData, socket)
    
        // // JSON 데이터를 파일로 저장
        // fs.writeFileSync('rds_performance.json', jsonData);
        // console.log('2주간 최대 성능 정보가 성공적으로 저장되었습니다: rds_performance.json'); 
      })
      .catch(error => {
        console.error('에러:', error);
      }); 

  }catch (error) {
    logger(error.message, socket);
    logger("Unable to retrieve rds information. Maybe RDS doesn't exist.", socket);
    logger("=================================================================================", socket);
    //res.json([]);
    socket.emit("send_opted_rds", JSON.stringify([]));
  }
} 

function mkdir( dirPath ) {
  const isExists = fs.existsSync( dirPath );
  if( !isExists ) {
      fs.mkdirSync( dirPath, { recursive: true } );
  }
}
