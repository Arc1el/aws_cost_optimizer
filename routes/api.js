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

router.get('/ec2/:region_seq/:id', async function (req, res, next) {
  try {
    const currentTimeStamp = Date.now();
    const region = Object.keys(regions)[req.params.region_seq];
    const url = `https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/${region}/Linux/index.json?timestamp=${currentTimeStamp}`;
    const response = await axios.get(url);
    const jsonData = response.data;
    const regionData = jsonData.regions[region];
    const prices = Object.keys(regionData).reduce((result, instanceType) => {
      const price = regionData[instanceType].price;
      result[regionData[instanceType]['Instance Type']] = price;
      return result;
    }, {});

    console.log("=================================================================================" +
      "\nGet Price Data Successfully! Time : " + currentTimeStamp + " / Region : " + region );

    const switchRegion = regions[Object.keys(regions)[req.params.region_seq]];
    AWS.config.update({ region: switchRegion });
    AWS.config.credentials = new AWS.TemporaryCredentials({
      RoleArn: `arn:aws:iam::${req.params.id}:role/Smileshark-sysadmin`, // Replace with your ARN role
    });
    const ec2 = new AWS.EC2();
    const result = [];
    const data = await ec2.describeInstances({ Filters: [{ Name: 'instance-state-name', Values: ['running'] }] }).promise();
    const instances = data.Reservations.reduce((acc, reservation) => {
      acc.push(...reservation.Instances);
      return acc;
    }, []);
    console.log("Get EC2 Instances...");
    for (const instance of instances) {
      const instanceId = instance.InstanceId;
      process.stdout.write("instance : " + instanceId);
      const instanceName = instance.Tags[0].Value;
      const instanceType = instance.InstanceType;
      const instanceData = {
        region: switchRegion,
        instanceName: instanceName,
        instanceId: instanceId,
        instanceType: instanceType,
        nowCost: parseFloat(prices[instanceType]).toFixed(3),
        proposedInstanceType: null,
        proposedCost: null
      };

      const widgetDefinition = {
        width: 800,
        height: 400,
        start: '-P14D',
        end: 'P0D',
        periodOverride: '1D',
        stacked: false,
        metrics: [
          ['AWS/EC2', 'CPUUtilization', 'InstanceId', instanceId, { stat: 'Maximum' }]
        ],
        view: 'timeSeries',
        stacked: false
      };

      const paramsCW = {
        MetricWidget: JSON.stringify(widgetDefinition)
      };
      const cloudwatch = new AWS.CloudWatch();
      mkdir(`./chart/${req.params.id}/${instanceId}`);
      const { MetricWidgetImage: image } = await cloudwatch.getMetricWidgetImage(paramsCW).promise();

      process.stdout.write(" / Generating chart...");
      fs.writeFile(`./chart/${req.params.id}/${instanceId}/chart.png`, image, 'base64', (err) => {
        if (err) {
          console.log('Error', err);
        }
      });

      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - (14 * 24 * 60 * 60 * 1000));
      const params = {
        EndTime: endTime,
        MetricName: 'CPUUtilization',
        Namespace: 'AWS/EC2',
        Period: 86400, // 24 hours in seconds
        StartTime: startTime,
        Statistics: ['Maximum'],
        Dimensions: [
          {
            Name: 'InstanceId',
            Value: instanceId
          }
        ],
        Unit: 'Percent'
      };

      const cloudWatchData = await cloudwatch.getMetricStatistics(params).promise();

      const maxCpuUsage = cloudWatchData.Datapoints.reduce((max, datapoint) => {
        return datapoint.Maximum > max ? datapoint.Maximum : max;
      }, 0);

      if (maxCpuUsage !== 0) {
        instanceData.maxCpuUsage = maxCpuUsage.toFixed(2) + " %";

        if (maxCpuUsage >= 80) {
          const proposedType = proposeHigherInstanceType(instanceType);
          instanceData.proposedCost = parseFloat(prices[proposedType]).toFixed(3);
          instanceData.proposedInstanceType = "▲ " + proposedType;
        } else if (maxCpuUsage <= 40) {
          const proposedType = proposeLowerInstanceType(instanceType);
          instanceData.proposedCost = parseFloat(prices[proposedType]).toFixed(3);
          instanceData.proposedInstanceType = "▼ " + proposedType;
        } else {
          const proposedType = proposeNowInstanceType(instanceType);
          instanceData.proposedCost = parseFloat(prices[proposedType]).toFixed(3);
          instanceData.proposedInstanceType = "≡ " + proposedType;
        }
        
        process.stdout.write(" / Collecting instance data...\n");
        result.push(instanceData);
      }
    }

    // clearTimeout(timeout);
    console.log("=================================================================================");
    res.json(result);
  } catch (error) {
    console.log("Unable to retrieve ec2 information. Maybe ec2 doesn't exist")
    console.log("=================================================================================");
    res.json([]);
  }
});

function proposeHigherInstanceType(currentInstanceType) {
  //상위 인스턴스 정의. 세대업그레이드 포함
  const instanceTypeMap = {
    // 범용t, 세대업글부터
    't2.micro': 't3.small',
    't2.small': 't3.medium',
    't2.medium': 't3.large',
    't2.large': 't3.xlarge',
    't2.xlarge': 't3.2xlarge',
    't2.2xlarge': 't3.2xlarge',
    // 범용t
    't3.micro': 't3.small',
    't3.small': 't3.medium',
    't3.medium': 't3.large',
    't3.large': 't3.xlarge',
    't3.xlarge': 't3.2xlarge',
    't3.2xlarge': 't3.2xlarge',
    // 범용 m4, 세대업글부터
    'm4.large': 'm6i.xlarge',
    'm4.xlarge': 'm6i.2xlarge',
    'm4.2xlarge': 'm6i.4xlarge',
    'm4.4xlarge': 'm6i.8xlarge',
    'm4.10xlarge': 'm6i.12xlarge',
    'm4.16xlarge': 'm6i.16xlarge',
    // 범용 m5, 세대업글부터
    'm5.large': 'm6i.xlarge',
    'm5.xlarge': 'm6i.2xlarge',
    'm5.2xlarge': 'm6i.4xlarge',
    'm5.4xlarge': 'm6i.8xlarge',
    'm5.8xlarge': 'm6i.12xlarge',
    'm5.12xlarge': 'm6i.16xlarge',
    'm5.16xlarge': 'm6i.24xlarge',
    'm5.24xlarge': 'm6i.32xlarge',
    // 범용 m6i
    'm6i.large': 'm6i.xlarge',
    'm6i.xlarge': 'm6i.2xlarge',
    'm6i.2xlarge': 'm6i.4xlarge',
    'm6i.4xlarge': 'm6i.8xlarge',
    'm6i.8xlarge': 'm6i.12xlarge	',
    'm6i.12xlarge	': 'm6i.16xlarge',
    'm6i.16xlarge	': 'm6i.24xlarge',
    'm6i.24xlarge': 'm6i.32xlarge',
    'm6i.32xlarge': 'm6i.metal',
    // 컴퓨팅 c4, 세대 업글부터
    'c4.large': 'c5.xlarge',
    'c4.xlarge': 'c5.2xlarge',
    'c4.2xlarge': 'c5.4xlarge',
    'c4.4xlarge': 'c5.9xlarge',
    'c4.8xlarge': 'c5.12xlarge',
    // 컴퓨팅 c5, 세대 업글부터
    'c5.large': 'c6i.xlarge',
    'c5.xlarge': 'c6i.2xlarge',
    'c5.2xlarge': 'c6i.4xlarge',
    'c5.4xlarge': 'c6i.8xlarge',
    'c5.9xlarge': 'c6i.12xlarge',
    'c5.12xlarge': 'c6i.16xlarge',
    'c5.18xlarge': 'c6i.24xlarge',
    'c5.24xlarge': 'c6i.32xlarge',
    // 컴퓨팅 c6
    'c6i.large': 'c6i.xlarge',
    'c6i.xlarge': 'c6i.2xlarge',
    'c6i.2xlarge': 'c6i.4xlarge',
    'c6i.4xlarge': 'c6i.8xlarge',
    'c6i.8xlarge': 'c6i.12xlarge',
    'c6i.12xlarge': 'c6i.16xlarge',
    'c6i.16xlarge': 'c6i.24xlarge',
    'c6i.24xlarge': 'c6i.32xlarge',
    'c6i.32xlarge': 'c6i.metal',
    // 메모리 r, 세대업글부터
    'r4.large': 'r6i.xlarge',
    'r4.xlarge': 'r6i.2xlarge',
    'r4.2xlarge': 'r6i.4xlarge',
    'r4.4xlarge': 'r6i.8xlarge',
    'r4.8xlarge': 'r6i.12xlarge',
    'r4.16xlarge': 'r6i.24xlarge',
    // 메모리 r5
    'r5.large': 'r6i.xlarge',
    'r5.xlarge': 'r6i.2xlarge',
    'r5.2xlarge': 'r6i.4xlarge',
    'r5.4xlarge': 'r6i.8xlarge',
    'r5.8xlarge': 'r6i.12xlarge',
    'r5.12xlarge': 'r6i.16xlarge',
    'r5.16xlarge': 'r6i.24xlarge',
    'r5.24xlarge': 'r6i.metal',
    // 메모리 r6
    'r6i.large': 'r6i.xlarge',
    'r6i.xlarge': 'r6i.2xlarge',
    'r6i.2xlarge': 'r6i.4xlarge',
    'r6i.4xlarge': 'r6i.8xlarge',
    'r6i.8xlarge': 'r6i.12xlarge',
    'r6i.12xlarge': 'r6i.16xlarge',
    'r6i.16xlarge	': 'r6i.24xlarge',
    'r6i.24xlarge': 'r6i.32xlarge',
    'r6i.32xlarge': 'r6i.metal',
    // 가속화 컴퓨팅 p, 세대업글부터
    'p3.2xlarge': 'p4d.24xlarge',
    'p3.8xlarge': 'p4d.24xlarge',
    'p3.16xlarge': 'p4d.24xlarge',
    'p3dn.24xlarge': 'p4d.24xlarge',
    // 가속화 컴푸팅 p
    'p4d.24xlarge': 'p4de.24xlarge',
    // 스토리지 최적화 i3en, 세대업글부터
    'i3en.large': 'i4i.xlarge',
    'i3en.xlarge': 'i4i.2xlarge',
    'i3en.2xlarge': 'i4i.4xlarge',
    'i3en.3xlarge': 'i4i.8xlarge',
    'i3en.6xlarge': 'i4i.8xlarge',
    'i3en.12xlarge': 'i4i.16xlarge',
    'i3en.24xlarge': 'i4i.32xlarge',
    'i3en.metal': 'i4i.metal',
    // 스토리지 최적화 i3, 세대 업글부터
    'i3.large': 'i4i.xlarge',
    'i3.xlarge': 'i4i.2xlarge',
    'i3.2xlarge': 'i4i.4xlarge',
    'i3.4xlarge': 'i4i.8xlarge',
    'i3.8xlarge': 'i4i.16xlarge',
    'i3.16xlarge': 'i4i.32xlarge',
    'i3.metal': 'i4i.metal',
    // 스토리지 최적화 i4i
    'i4i.large': 'i4i.xlarge',
    'i4i.xlarge': 'i4i.2xlarge',
    'i4i.2xlarge': 'i4i.4xlarge',
    'i4i.4xlarge': 'i4i.8xlarge',
    'i4i.8xlarge': 'i4i.16xlarge',
    'i4i.16xlarge': 'i4i.32xlarge',
    'i4i.32xlarge': 'i4i.metal',
    // 필요한 인스턴스 타입에 따라 매핑을 추가합니다.
  };

  // 현재 인스턴스 타입이 매핑 테이블에 있는지 확인하고, 상위 인스턴스 타입을 반환합니다.
  if (instanceTypeMap.hasOwnProperty(currentInstanceType)) {
    return instanceTypeMap[currentInstanceType];
  }

  // 매핑 테이블에 없는 경우, 직전 인스턴스 타입을 반환하거나 다른 로직을 추가할 수 있습니다.
  return currentInstanceType;
}
function proposeLowerInstanceType(currentInstanceType) {
  // 현재 인스턴스 타입에 따라 하위 인스턴스 타입을 결정합니다.
  // 예시로 t2.small, t2.medium, t2.large, t2.xlarge의 하위 인스턴스 타입을 결정하도록 하겠습니다.
  const instanceTypeMap = {
    // 범용t, 세대업글부터
    't2.micro': 't3.micro',
    't2.small': 't3.small',
    't2.medium': 't3.small',
    't2.large': 't3.medium',
    't2.xlarge': 't3.large',
    't2.2xlarge': 't3.xlarge',
    // 범용t
    't3.micro': 't3.micro',
    't3.small': 't3.small',
    't3.medium': 't3.small',
    't3.large': 't3.medium',
    't3.xlarge': 't3.large',
    't3.2xlarge': 't3.xlarge',
    // 범용 m4, 세대업글부터
    'm4.large': 'm6i.large',
    'm4.xlarge': 'm6i.large',
    'm4.2xlarge': 'm6i.xlarge',
    'm4.4xlarge': 'm6i.2xlarge',
    'm4.10xlarge': 'm6i.4xlarge',
    'm4.16xlarge': 'm6i.8xlarge',
    // 범용 m4, 세대업글부터
    'm5.large': 'm6i.large',
    'm5.xlarge': 'm6i.large',
    'm5.2xlarge': 'm6i.xlarge',
    'm5.4xlarge': 'm6i.2xlarge',
    'm5.8xlarge': 'm6i.4xlarge',
    'm5.12xlarge': 'm6i.8xlarge',
    'm5.16xlarge': 'm6i.12xlarge',
    'm5.24xlarge': 'm6i.16xlarge',
    // 범용 m6
    'm6i.large': 'm6i.large',
    'm6i.xlarge': 'm6i.large',
    'm6i.2xlarge': 'm6i.xlarge',
    'm6i.4xlarge': 'm6i.2xlarge',
    'm6i.8xlarge': 'm6i.4xlarge	',
    'm6i.12xlarge	': 'm6i.8xlarge',
    'm6i.16xlarge	': 'm6i.12xlarge',
    'm6i.24xlarge': 'm6i.16xlarge',
    'm6i.32xlarge': 'm6i.24xlarge',
    'm6i.metal': 'm6i.32xlarge',
    // 컴퓨팅 c4, 세대 업글부터
    'c4.large': 'c5.large',
    'c4.xlarge': 'c5.large',
    'c4.2xlarge': 'c5.2xlarge',
    'c4.4xlarge': 'c5.4xlarge',
    'c4.8xlarge': 'c5.4xlarge',
    // 컴퓨팅 c5, 세대 업글부터
    'c5.large': 'c6i.large',
    'c5.xlarge': 'c6i.large',
    'c5.2xlarge': 'c6i.xlarge',
    'c5.4xlarge': 'c6i.2xlarge',
    'c5.9xlarge': 'c6i.4xlarge',
    'c5.12xlarge': 'c6i.8xlarge',
    'c5.18xlarge': 'c6i.12xlarge',
    'c5.24xlarge': 'c6i.16xlarge',
    // 컴퓨팅 c6
    'c6i.large': 'c6i.large',
    'c6i.xlarge': 'c6i.large',
    'c6i.2xlarge': 'c6i.xlarge',
    'c6i.4xlarge': 'c6i.2xlarge',
    'c6i.8xlarge': 'c6i.4xlarge',
    'c6i.12xlarge': 'c6i.8xlarge',
    'c6i.16xlarge': 'c6i.12xlarge',
    'c6i.24xlarge': 'c6i.16xlarge',
    'c6i.32xlarge': 'c6i.24xlarge',
    'c6i.metal': 'c6i.32xlarge',
    // 메모리 r, 세대업글부터
    'r4.large': 'r5.large',
    'r4.xlarge': 'r5.large',
    'r4.2xlarge': 'r5.xlarge',
    'r4.4xlarge': 'r5.2xlarge',
    'r4.8xlarge': 'r5.4xlarge',
    'r4.16xlarge': 'r5.8xlarge',
    // 메모리 r5
    'r5.large': 'r5.large',
    'r5.xlarge': 'r5.large',
    'r5.2xlarge': 'r5.xlarge',
    'r5.4xlarge': 'r5.2xlarge',
    'r5.8xlarge': 'r5.4xlarge',
    'r5.12xlarge': 'r5.8xlarge',
    'r5.16xlarge': 'r5.12xlarge',
    'r5.24xlarge': 'r5.16xlarge',
    'r5.metal': 'r5.24xlarge',
    // 메모리 r6
    'r6i.large': 'r6i.large',
    'r6i.xlarge': 'r6i.large',
    'r6i.2xlarge': 'r6i.xlarge',
    'r6i.4xlarge': 'r6i.2xlarge',
    'r6i.8xlarge': 'r6i.4xlarge',
    'r6i.12xlarge': 'r6i.8xlarge',
    'r6i.16xlarge	': 'r6i.12xlarge',
    'r6i.24xlarge': 'r6i.16xlarge',
    'r6i.32xlarge': 'r6i.24xlarge',
    // 가속화 컴퓨팅 p, 세대업글부터
    'p3.2xlarge': 'p4d.24xlarge',
    'p3.8xlarge': 'p4d.24xlarge',
    'p3.16xlarge': 'p4d.24xlarge',
    'p3dn.24xlarge': 'p4d.24xlarge',
    // 가속화 컴푸팅 p
    'p4d.24xlarge': 'p4de.24xlarge',
    // 스토리지 최적화 i3en, 세대업글부터
    'i3en.large': 'i4i.large',
    'i3en.xlarge': 'i4i.large',
    'i3en.2xlarge': 'i4i.xlarge',
    'i3en.3xlarge': 'i4i.2xlarge',
    'i3en.6xlarge': 'i4i.4xlarge',
    'i3en.12xlarge': 'i4i.8xlarge',
    'i3en.24xlarge': 'i4i.16xlarge',
    'i3en.metal': 'i4i.32xlarge',
    // 스토리지 최적화 i3, 세대 업글부터
    'i3.large': 'i4i.large',
    'i3.xlarge': 'i4i.large',
    'i3.2xlarge': 'i4i.xlarge',
    'i3.4xlarge': 'i4i.2xlarge',
    'i3.8xlarge': 'i4i.4xlarge',
    'i3.16xlarge': 'i4i.8xlarge',
    'i3.metal': 'i4i.32xlarge',
    // 스토리지 최적화 i4i
    'i4i.large': 'i4i.large',
    'i4i.xlarge': 'i4i.large',
    'i4i.2xlarge': 'i4i.xlarge',
    'i4i.4xlarge': 'i4i.2xlarge',
    'i4i.8xlarge': 'i4i.4xlarge',
    'i4i.16xlarge': 'i4i.8xlarge',
    'i4i.32xlarge': 'i4i.32xlarge',
    // 필요한 인스턴스 타입에 따라 매핑을 추가합니다.
  };

  // 현재 인스턴스 타입이 매핑 테이블에 있는지 확인하고, 하위 인스턴스 타입을 반환합니다.
  if (instanceTypeMap.hasOwnProperty(currentInstanceType)) {
    return instanceTypeMap[currentInstanceType];
  }
  return currentInstanceType;
}
// 아무 조건도 해당이 안되기 때문에 세대만 업그레이드
function proposeNowInstanceType(currentInstanceType) {
   // 범용t, 세대업글부터
  const instanceTypeMap = {
    't2.micro': 't3.micro',
    't2.small': 't3.small',
    't2.medium': 't3.medium',
    't2.large': 't3.large',
    't2.xlarge': 't3.xlarge',
    't2.2xlarge': 't3.2xlarge',
    // 범용 m, 세대업글부터
    'm4.large': 'm6i.large',
    'm4.xlarge': 'm6i.xlarge',
    'm4.2xlarge': 'm6i.2xlarge',
    'm4.4xlarge': 'm6i.4xlarge',
    'm4.10xlarge': 'm6i.12xlarge',
    'm4.16xlarge': 'm6i.16xlarge',
     // 범용 m5, 세대업글부터
    'm5.large': 'm6i.large',
    'm5.xlarge': 'm6i.xlarge',
    'm5.2xlarge': 'm6i.2xlarge',
    'm5.4xlarge': 'm6i.4xlarge',
    'm5.8xlarge': 'm6i.8xlarge',
    'm5.12xlarge': 'm6i.12xlarge',
    'm5.16xlarge': 'm6i.16xlarge',
    'm5.24xlarge': 'm6i.24xlarge',
    // 컴퓨팅 c4, 세대 업글부터
    'c4.large': 'c6i.large',
    'c4.xlarge': 'c6i.xlarge',
    'c4.2xlarge': 'c6i.2xlarge',
    'c4.4xlarge': 'c6i.4xlarge',
    'c4.8xlarge': 'c6i.8xlarge',
    // 컴퓨팅 c5, 세대 업글부터
    'c5.large': 'c6i.large',
    'c5.xlarge': 'c6i.xlarge',
    'c5.2xlarge': 'c6i.2xlarge',
    'c5.4xlarge': 'c6i.4xlarge',
    'c5.9xlarge': 'c6i.12xlarge',
    'c5.12xlarge': 'c6i.12xlarge',
    'c5.18xlarge': 'c6i.24xlarge',
    'c5.24xlarge': 'c6i.24xlarge',
    // 메모리 r4, 세대업글부터
    'r4.large': 'r6i.large',
    'r4.xlarge': 'r6i.xlarge',
    'r4.2xlarge': 'r6i.2xlarge',
    'r4.4xlarge': 'r6i.4xlarge',
    'r4.8xlarge': 'r6i.8xlarge',
    'r4.16xlarge': 'r6i.16xlarge',
    // 메모리 r5, 세대업글부터
    'r5.large': 'r6i.large',
    'r5.xlarge': 'r6i.xlarge',
    'r5.2xlarge': 'r6i.2xlarge',
    'r5.4xlarge': 'r6i.4xlarge',
    'r5.8xlarge': 'r6i.8xlarge',
    'r5.12xlarge': 'r6i.12xlarge',
    'r5.16xlarge': 'r6i.16xlarge',
    'r5.24xlarge': 'r6i.24xlarge',
    // 가속화 컴퓨팅 p, 세대업글부터
    'p3.2xlarge': 'p4d.24xlarge',
    'p3.8xlarge': 'p4d.24xlarge',
    'p3.16xlarge': 'p4d.24xlarge',
    'p3dn.24xlarge': 'p4d.24xlarge',
    // 스토리지 최적화 i3en, 세대업글부터
    'i3en.large': 'i4i.large',
    'i3en.xlarge': 'i4i.xlarge',
    'i3en.2xlarge': 'i4i.2xlarge',
    'i3en.3xlarge': 'i4i.4xlarge',
    'i3en.6xlarge': 'i4i.8xlarge',
    'i3en.12xlarge': 'i4i.16xlarge',
    'i3en.24xlarge': 'i4i.32xlarge',
    'i3en.metal': 'i4i.metal',
    // 스토리지 최적화 i3, 세대 업글부터
    'i3.large': 'i4i.large',
    'i3.xlarge': 'i4i.xlarge',
    'i3.2xlarge': 'i4i.2xlarge',
    'i3.4xlarge': 'i4i.4xlarge',
    'i3.8xlarge': 'i4i.8xlarge',
    'i3.16xlarge': 'i4i.16xlarge',
    'i3.metal': 'i4i.metal',
  }

  if (instanceTypeMap.hasOwnProperty(currentInstanceType)) {
    return instanceTypeMap[currentInstanceType];
  }
  return currentInstanceType;
}

function mkdir( dirPath ) {
  const isExists = fs.existsSync( dirPath );
  if( !isExists ) {
      fs.mkdirSync( dirPath, { recursive: true } );
  }
}

module.exports = router;
