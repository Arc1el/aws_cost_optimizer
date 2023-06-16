const express = require('express');
const router = express.Router();
const axios = require('axios');
const fs = require('fs');
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


const cloudwatch = new AWS.CloudWatch();
const rds = new AWS.RDS();

// RDS 인스턴스 정보 가져오기
async function getRDSInstanceInfo() {
  const response = await rds.describeDBInstances().promise();
  const instances = response.DBInstances;

  const instanceInfo = instances.map((instance) => {
    return {
      DBInstanceIdentifier: instance.DBInstanceIdentifier,
      Engine: instance.Engine,
      AllocatedStorage: instance.AllocatedStorage,
      InstanceClass: instance.DBInstanceClass,
      AvailabilityZone: instance.AvailabilityZone,
    };
  });

  return instanceInfo;
}

// Performance Insights 활성화 여부 확인
async function isPerformanceInsightsEnabled(dbInstanceIdentifier) {
  const response = await rds
    .describeDBInstances({ DBInstanceIdentifier: dbInstanceIdentifier })
    .promise();

  const instance = response.DBInstances[0];
  return instance.PerformanceInsightsEnabled;
}

// Performance Insights 데이터 가져오기
async function getPerformanceInsightsData(dbInstanceIdentifier) {
  const response = await rds
    .describeDBInstances({ DBInstanceIdentifier: dbInstanceIdentifier })
    .promise();

  const instance = response.DBInstances[0];
  const performanceInsightsArn = instance.PerformanceInsightsArn;

  const startTime = new Date(Date.now() - 3600000); // 1시간 전의 데이터
  const endTime = new Date();

  const params = {
    ServiceType: 'RDS',
    StartTime: startTime,
    EndTime: endTime,
    MetricQueries: [
      {
        Metric: 'db.load.avg',
        GroupBy: [{ Type: 'Dimension', Key: 'db.sql' }],
      },
      {
        Metric: 'db.cpu.user.pct',
        GroupBy: [{ Type: 'Dimension', Key: 'db.sql' }],
      },
      {
        Metric: 'db.memory',
        GroupBy: [{ Type: 'Dimension', Key: 'db.sql' }],
      },
    ],
    PeriodInSeconds: 60,
    Filter: 'db.sql',
    Granularity: '1MINUTE',
    Identifier: performanceInsightsArn,
  };

  const performanceData = await rds.describeDimensionKeys(params).promise();
  return performanceData;
}

// CloudWatch 메트릭 데이터 가져오기
async function getCloudWatchMetrics(dbInstanceIdentifier) {
  const startTime = new Date(Date.now() - 3600000); // 1시간 전의 데이터
  const endTime = new Date();

  const params = {
    StartTime: startTime,
    EndTime: endTime,
    Period: 60,
    Namespace: 'AWS/RDS',
    MetricName: 'WriteLatency',
    Dimensions: [
      {
        Name: 'DBInstanceIdentifier',
        Value: dbInstanceIdentifier,
      },
    ],
    Statistics: ['Average'],
  };

  const response = await cloudwatch.getMetricData(params).promise();
  return response.MetricDataResults;
}

router.get('/rds/:region_seq/:id', async function (req, res, next) {
 
    // const currentTimeStamp = Date.now();
    // const region = Object.keys(regions)[req.params.region_seq];
    // const url = `https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/${region}/Linux/index.json?timestamp=${currentTimeStamp}`;
    // const response = await axios.get(url);
    // const jsonData = response.data;
    // const regionData = jsonData.regions[region];
    // const prices = Object.keys(regionData).reduce((result, instanceType) => {
    //   const price = regionData[instanceType].price;
    //   result[regionData[instanceType]['Instance Type']] = price;
    //   return result;
    // }, {});

    // console.log("=================================================================================" +
    //   "\nGet Price Data Successfully! Time : " + currentTimeStamp + " / Region : " + region );
    // const switchRegion = regions[Object.keys(regions)[req.params.region_seq]];
    // AWS.config.update({ region: switchRegion });
    // AWS.config.credentials = new AWS.TemporaryCredentials({
    //   RoleArn: `arn:aws:iam::${req.params.id}:role/Smileshark-sysadmin`, // Replace with your ARN role
    // });

  try {
    const switchRegion = regions[Object.keys(regions)[req.params.region_seq]];
    
    
    const rdsInstanceInfo = await getRDSInstanceInfo();
    console.log('RDS Instance Info:', JSON.stringify(rdsInstanceInfo, null, 2));

    for (const instance of rdsInstanceInfo) {
      const dbInstanceIdentifier = instance.DBInstanceIdentifier;

      // Performance Insights 사용 여부 확인
      const isPIEnabled = await isPerformanceInsightsEnabled(dbInstanceIdentifier);

      if (isPIEnabled) {
        // Performance Insights 데이터 가져오기
        const performanceData = await getPerformanceInsightsData(dbInstanceIdentifier);
        console.log('Performance Insights Data:', JSON.stringify(performanceData, null, 2));
      } else {
        // CloudWatch 메트릭 데이터 가져오기
        const cloudWatchMetrics = await getCloudWatchMetrics(dbInstanceIdentifier);
        console.log('CloudWatch Metrics:', JSON.stringify(cloudWatchMetrics, null, 2));

        // CloudWatch 차트 생성 및 로컬에 저장
        const widgetParams = {
          MetricWidget: JSON.stringify({
            view: 'timeSeries',
            stacked: false,
            metrics: [
              ['AWS/RDS', 'WriteLatency', 'DBInstanceIdentifier', dbInstanceIdentifier, 'Average'],
              ['AWS/RDS', 'ReadLatency', 'DBInstanceIdentifier', dbInstanceIdentifier, 'Average'],
              ['AWS/RDS', 'CPUUtilization', 'DBInstanceIdentifier', dbInstanceIdentifier, 'Average'],
              ['AWS/RDS', 'FreeableMemory', 'DBInstanceIdentifier', dbInstanceIdentifier, 'Average'],
            ],
            region: 'AWS_REGION', // AWS_REGION을 원하는 지역으로 변경하세요.
            title: `RDS Metrics - ${dbInstanceIdentifier}`,
            width: 800,
            height: 400,
          }),
        };

        const widgetImageResponse = await cloudwatch.getMetricWidgetImage(widgetParams).promise();
        fs.writeFileSync(`chart_${dbInstanceIdentifier}.png`, widgetImageResponse.MetricWidgetImage);
        console.log(`Chart saved: chart_${dbInstanceIdentifier}.png`);
      }
    }
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'An error occurred' });
  }
});

router.use((req, res, next) => {
  // Middleware logic here
  next(); // Call next() to pass control to the next middleware or route handler
});

module.exports = router;
