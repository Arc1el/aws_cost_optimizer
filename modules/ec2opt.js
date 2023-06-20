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

function logger(data, socket) {
  console.log(data); 
  socket.emit('console_logger', data); 
}

exports.test = function ({socket, data}) {
    socket.emit('test', data);
}
exports.opt = async function ({socket, data}){
  var region_seq = data.number;
  var id = data.role;
  try {
    const currentTimeStamp = Date.now();
    const region = Object.keys(regions)[region_seq];
    const url = `https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/${region}/Linux/index.json?timestamp=${currentTimeStamp}`;
    const response = await axios.get(url);
    const jsonData = response.data;
    const regionData = jsonData.regions[region];
    const prices = Object.keys(regionData).reduce((result, instanceType) => {
      const price = regionData[instanceType].price;
      result[regionData[instanceType]['Instance Type']] = price;
      return result;
    }, {});

    logger(`=================================================================================
    \nGet Price Data Successfully! Time : ${currentTimeStamp} / Region : ${region}`, socket);

    const switchRegion = regions[Object.keys(regions)[region_seq]];
    AWS.config.update({ region: switchRegion });
    AWS.config.credentials = new AWS.TemporaryCredentials({
      RoleArn: `arn:aws:iam::${id}:role/Smileshark-sysadmin`, // Replace with your ARN role
    });
    const ec2 = new AWS.EC2();
    const result = [];
    const data = await ec2.describeInstances({ Filters: [{ Name: 'instance-state-name', Values: ['running'] }] }).promise();
    const instances = data.Reservations.flatMap((reservation) => reservation.Instances);
    var counter = 0;
    logger("Get EC2 Instances...", socket);
    for (const instance of instances) {
      socket.emit("opt_ec2_list", {total_length : instances.length, length : counter++})
      const instanceId = instance.InstanceId;
      logger(`instance : ${instanceId}`, socket);
      let instanceName = null;
      for (const tag of instance.Tags) {
        if (tag.Key === 'Name') {
          instanceName = tag.Value;
          break;
        }
      }
      if (!instanceName) { instanceName = instance.Tags[0].Value }
      const instanceType = instance.InstanceType;
      const instanceData = {
        region: switchRegion,
        instanceName: instanceName,
        instanceId: instanceId,
        instanceType: instanceType,
        nowCost: parseFloat(prices[instanceType]).toFixed(3),
        proposedInstanceType: null,
        proposedCost: null,
        maxCpuUsage: null,
        mem_maximum: null,
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
      mkdir(`./chart/${id}/${instanceId}`);
      const { MetricWidgetImage: image } = await cloudwatch.getMetricWidgetImage(paramsCW).promise();

      logger(" / Generating chart...", socket);
      fs.writeFile(`./chart/${id}/${instanceId}/chart.png`, image, 'base64', (err) => {
        if (err) {
          logger(err, socket);
        }
      });
      logger("OK / ", socket);

      const cloudwatchAgent = new AWS.CloudWatch();
      mkdir(`./chart/${id}/${instanceId}`);
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - (14 * 24 * 60 * 60 * 1000));
      // Get all metrics
      const { Metrics: allMetrics } = await cloudwatchAgent.listMetrics().promise();

      const filteredMetrics = allMetrics.filter(
        metric => !metric.Namespace.startsWith('AWS/') && metric.MetricName === 'mem_used_percent'
      );

      // Generate individual charts based on filtered metrics
      logger(`Generating chart for Memory Usage`, socket);
      for (const metric of filteredMetrics) {
        const { Namespace, MetricName } = metric;

        const widgetDefinition = {
          width: 800,
          height: 400,
          start: '-P14D',
          end: 'P0D',
          periodOverride: '1D',
          stacked: false,
          metrics: [
            [Namespace, MetricName, 'InstanceId', instanceId, { stat: 'Maximum' }]
          ],
          view: 'timeSeries',
          stacked: false
        };

        var mem_paramsCW = {
          MetricWidget: JSON.stringify(widgetDefinition)
        };
        
      }
      if(mem_paramsCW){
        const { MetricWidgetImage: mem_image } = await cloudwatchAgent.getMetricWidgetImage(mem_paramsCW).promise();

        const fileName = `mem_used_percent_chart.png`;
          fs.writeFile(`./chart/${id}/${instanceId}/${fileName}`, mem_image, 'base64', (err) => {
            logger(`...OK`, socket);
            if (err) {
              logger(err, socket);
            }
          });
        ;

        if (filteredMetrics.length === 0) {
          logger(" No 'mem_used_percent' metrics found.", socket);
        }
      }
      

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

      const mem_params = {
        EndTime: endTime,
        MetricName: 'mem_used_percent',
        Namespace: 'CWAgent',
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

      const mem_cloudWatchData = await cloudwatch.getMetricStatistics(mem_params).promise();

      const mem_maximum = mem_cloudWatchData.Datapoints.reduce((max, datapoint) => {
        return datapoint.Maximum > max ? datapoint.Maximum : max;
      }, 0);

      if (mem_maximum !== 0) {
        instanceData.mem_maximum = mem_maximum.toFixed(2) + " %";
      } else {
        instanceData.mem_maximum = "0 %";
      }

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

    logger("=================================================================================", socket);
    //res.json(result);
    socket.emit("send_opted_ec2", JSON.stringify(result));
  } catch (error) {
    logger(error.message, socket);
    logger("Unable to retrieve EC2 information. Maybe EC2 doesn't exist.", socket);
    logger("=================================================================================", socket);
    //res.json([]);
    socket.emit("send_opted_ec2", JSON.stringify([]));
  }
}

//socket.emit("send_opted_ec2", JSON.stringify(result));

function proposeHigherInstanceType(currentInstanceType) {
  const instanceTypeMap = {
    //M4:
    "m4.large" : "m6i.xlarge",
    "m4.xlarge" : "m6i.2xlarge",
    "m4.2xlarge" : "m6i.4xlarge",
    "m4.4xlarge" : "m6i.8xlarge",
    "m4.10xlarge" : "m6i.12xlarge",
    "m4.16xlarge" : "m6i.24xlarge",

    //M5:
    "m5.large" : "m6i.xlarge",
    "m5.xlarge" : "m6i.2xlarge",
    "m5.2xlarge" : "m6i.4xlarge",
    "m5.4xlarge" : "m6i.8xlarge",
    "m5.8xlarge" : "m6i.12xlarge",
    "m5.12xlarge" : "m6i.16xlarge",
    "m5.16xlarge" : "m6i.24xlarge",
    "m5.24xlarge" : "m6i.32xlarge",
    "m5.metal" : "m6i.metal",

    //M5a:
    "m5a.large" : "m6a.xlarge",
    "m5a.xlarge" : "m6a.2xlarge",
    "m5a.2xlarge" : "m6a.4xlarge",
    "m5a.4xlarge" : "m6a.8xlarge",
    "m5a.8xlarge" : "m6a.12xlarge",
    "m5a.12xlarge" : "m6a.16xlarge",
    "m5a.16xlarge" : "m6a.24xlarge",
    "m5a.24xlarge" : "m6a.32xlarge",

    //M5ad:
    "m5ad.large" : "m6a.xlarge",
    "m5ad.xlarge" : "m6a.2xlarge",
    "m5ad.2xlarge" : "m6a.4xlarge",
    "m5ad.4xlarge" : "m6a.8xlarge",
    "m5ad.8xlarge" : "m6a.12xlarge",
    "m5ad.12xlarge" : "m6a.16xlarge",
    "m5ad.16xlarge" : "m6a.24xlarge",
    "m5ad.24xlarge" : "m6a.32xlarge",

    //M5d:
    "m5d.large" : "m6id.xlarge",
    "m5d.xlarge" : "m6id.2xlarge",
    "m5d.2xlarge" : "m6id.4xlarge",
    "m5d.4xlarge" : "m6id.8xlarge",
    "m5d.8xlarge" : "m6id.12xlarge",
    "m5d.12xlarge" : "m6id.16xlarge",
    "m5d.16xlarge" : "m6id.24xlarge",
    "m5d.24xlarge" : "m6id.32xlarge",
    "m5d.metal" : "m6id.metal",

    //M5dn:
    "m5dn.large" : "m6idn.xlarge",
    "m5dn.xlarge" : "m6idn.2xlarge",
    "m5dn.2xlarge" : "m6idn.4xlarge",
    "m5dn.4xlarge" : "m6idn.8xlarge",
    "m5dn.8xlarge" : "m6idn.12xlarge",
    "m5dn.12xlarge" : "m6idn.16xlarge",
    "m5dn.16xlarge" : "m6idn.24xlarge",
    "m5dn.24xlarge" : "m6idn.32xlarge",
    "m5dn.metal" : "m6id.metal",

    //M5n:
    "m5n.large" : "m6in.xlarge",
    "m5n.xlarge" : "m6in.2xlarge",
    "m5n.2xlarge" : "m6in.4xlarge",
    "m5n.4xlarge" : "m6in.8xlarge",
    "m5n.8xlarge" : "m6in.12xlarge",
    "m5n.12xlarge" : "m6in.16xlarge",
    "m5n.16xlarge" : "m6in.24xlarge",
    "m5n.24xlarge" : "m6in.32xlarge",
    "m5n.metal" : "m6in.metal",

    //M5zn:
    "m5zn.large" : "m6in.xlarge",
    "m5zn.xlarge" : "m6in.2xlarge",
    "m5zn.2xlarge" : "m6in.4xlarge",
    "m5zn.3xlarge" : "m6in.4xlarge",
    "m5zn.6xlarge" : "m6in.8xlarge",
    "m5zn.12xlarge" : "m6in.16xlarge",
    "m5zn.metal" : "m6in.metal",

    //M6a:
    "m6a.large" : "m6a.xlarge",
    "m6a.xlarge" : "m6a.xlarge",
    "m6a.2xlarge" : "m6a.xlarge",
    "m6a.4xlarge" : "m6a.xlarge",
    "m6a.8xlarge" : "m6a.xlarge",
    "m6a.12xlarge" : "m6a.xlarge",
    "m6a.16xlarge" : "m6a.xlarge",
    "m6a.24xlarge" : "m6a.xlarge",
    "m6a.32xlarge" : "m6a.xlarge",
    "m6a.48xlarge" : "m6a.xlarge",
    "m6a.metal" : "m6a.metal",

    //M6g:
    "m6g.medium" : "m7g.large",
    "m6g.large" : "m7g.xlarge",
    "m6g.xlarge" : "m7g.2xlarge",
    "m6g.2xlarge" : "m7g.4xlarge",
    "m6g.4xlarge" : "m7g.8xlarge",
    "m6g.8xlarge" : "m7g.12xlarge",
    "m6g.12xlarge" : "m7g.16xlarge",
    "m6g.16xlarge" : "m7g.metal",
    "m6g.metal" : "m7g.metal",

    //M6gd:
    "m6gd.medium" : "m7g.large",
    "m6gd.large" : "m7g.xlarge",
    "m6gd.xlarge" : "m7g.2xlarge",
    "m6gd.2xlarge" : "m7g.4xlarge",
    "m6gd.4xlarge" : "m7g.8xlarge",
    "m6gd.8xlarge" : "m7g.12xlarge",
    "m6gd.12xlarge" : "m7g.16xlarge",
    "m6gd.16xlarge" : "m7g.metal",
    "m6gd.metal" : "m7g.metal",

    //M6i:
    "m6i.large" : "m6i.xlarge",
    "m6i.xlarge" : "m6i.xlarge",
    "m6i.2xlarge" : "m6i.xlarge",
    "m6i.4xlarge" : "m6i.xlarge",
    "m6i.8xlarge" : "m6i.xlarge",
    "m6i.12xlarge" : "m6i.xlarge",
    "m6i.16xlarge" : "m6i.xlarge",
    "m6i.24xlarge" : "m6i.xlarge",
    "m6i.32xlarge" : "m6i.xlarge",
    "m6i.metal" : "m6i.xlarge",

    //M6id:
    "m6id.large" : "m6id.xlarge",
    "m6id.xlarge" : "m6id.2xlarge",
    "m6id.2xlarge" : "m6id.4xlarge",
    "m6id.4xlarge" : "m6id.8xlarge",
    "m6id.8xlarge" : "m6id.12xlarge",
    "m6id.12xlarge" : "m6id.16xlarge",
    "m6id.16xlarge" : "m6id.24xlarge",
    "m6id.24xlarge" : "m6id.32xlarge",
    "m6id.32xlarge" : "m6id.metal",
    "m6id.metal" : "m6id.metal",

    //M6idn:
    "m6idn.large" : "m6idn.xlarge",
    "m6idn.xlarge" : "m6idn.2xlarge",
    "m6idn.2xlarge" : "m6idn.4xlarge",
    "m6idn.4xlarge" : "m6idn.8xlarge",
    "m6idn.8xlarge" : "m6idn.12xlarge",
    "m6idn.12xlarge" : "m6idn.16xlarge",
    "m6idn.16xlarge" : "m6idn.24xlarge",
    "m6idn.24xlarge" : "m6idn.32xlarge",
    "m6idn.32xlarge" : "m6idn.metal",
    "m6idn.metal" : "m6idn.metal",

    //M6in:
    "m6in.large" : "m6in.xlarge",
    "m6in.xlarge" : "m6in.2xlarge",
    "m6in.2xlarge" : "m6in.4xlarge",
    "m6in.4xlarge" : "m6in.8xlarge",
    "m6in.8xlarge" : "m6in.12xlarge",
    "m6in.12xlarge" : "m6in.16xlarge",
    "m6in.16xlarge" : "m6in.24xlarge",
    "m6in.24xlarge" : "m6in.32xlarge",
    "m6in.32xlarge" : "m6in.metal",
    "m6in.metal" : "m6in.metal",

    //M7g:
    "m7g.medium" : "m7g.large",
    "m7g.large" : "m7g.xlarge",
    "m7g.xlarge" : "m7g.2xlarge",
    "m7g.2xlarge" : "m7g.4xlarge",
    "m7g.4xlarge" : "m7g.8xlarge",
    "m7g.8xlarge" : "m7g.12xlarge",
    "m7g.12xlarge" : "m7g.16xlarge",
    "m7g.16xlarge" : "m7g.metal",
    "m7g.metal" : "m7g.metal",

    //Mac1:
    "mac1.metal" : "mac2.metal",

    //Mac2:
    "mac2.metal" : "mac2.metal",

    //T2:
    "t2.nano" : "t3.micro",
    "t2.micro" : "t3.small",
    "t2.small" : "t3.medium",
    "t2.medium" : "t3.large",
    "t2.large" : "t3.xlarge",
    "t2.xlarge" : "t3.2xlarge",
    "t2.2xlarge" : "t3.2xlarge",

    //T3:
    "t3.nano" : "t3.micro",
    "t3.micro" : "t3.small",
    "t3.small" : "t3.medium",
    "t3.medium" : "t3.large",
    "t3.large" : "t3.xlarge",
    "t3.xlarge" : "t3.2xlarge",
    "t3.2xlarge" : "t3.2xlarge",

    //T3a:
    "t3a.nano" : "t3a.micro",
    "t3a.micro" : "t3a.small",
    "t3a.small" : "t3a.medium",
    "t3a.medium" : "t3a.large",
    "t3a.large" : "t3a.xlarge",
    "t3a.xlarge" : "t3a.2xlarge",
    "t3a.2xlarge" : "t3a.2xlarge",

    //T4g:
    "t4g.nano" : "t4g.micro",
    "t4g.micro" : "t4g.small",
    "t4g.small" : "t4g.medium",
    "t4g.medium" : "t4g.large",
    "t4g.large" : "t4g.xlarge",
    "t4g.xlarge" : "t4g.2xlarge",
    "t4g.2xlarge" : "t4g.2xlarge",

    //C4:
    "c4.large" : "c6i.xlarge",
    "c4.xlarge" : "c6i.2xlarge",
    "c4.2xlarge" : "c6i.4xlarge",
    "c4.4xlarge" : "c6i.8xlarge",
    "c4.8xlarge" : "c6i.12xlarge",
    
    //C5:
    "c5.large" : "c6i.xlarge",
    "c5.xlarge" : "c6i.2xlarge",
    "c5.2xlarge" : "c6i.4xlarge",
    "c5.4xlarge" : "c6i.8xlarge",
    "c5.9xlarge" : "c6i.12xlarge",
    "c5.12xlarge" : "c6i.16xlarge",
    "c5.18xlarge" : "c6i.24xlarge",
    "c5.24xlarge" : "c6i.32xlarge",
    "c5.metal" : "c6i.metal",
    
    //C5a:
    "c5a.large" : "c6a.xlarge",
    "c5a.xlarge" : "c6a.2xlarge",
    "c5a.2xlarge" : "c6a.4xlarge",
    "c5a.4xlarge" : "c6a.8xlarge",
    "c5a.8xlarge" : "c6a.12xlarge",
    "c5a.12xlarge" : "c6a.16xlarge",
    "c5a.16xlarge" : "c6a.24xlarge",
    "c5a.24xlarge" : "c6a.32xlarge",
    
    //C5ad:
    "c5ad.large" : "c5ad.xlarge",
    "c5ad.xlarge" : "c5ad.2xlarge",
    "c5ad.2xlarge" : "c5ad.4xlarge",
    "c5ad.4xlarge" : "c5ad.8xlarge",
    "c5ad.8xlarge" : "c5ad.12xlarge",
    "c5ad.12xlarge" : "c5ad.16xlarge",
    "c5ad.16xlarge" : "c5ad.24xlarge",
    "c5ad.24xlarge" : "c5ad.24xlarge",
    
    //C5d:
    "c5d.large" : "c6id.xlarge",
    "c5d.xlarge" : "c6id.2xlarge",
    "c5d.2xlarge" : "c6id.4xlarge",
    "c5d.4xlarge" : "c6id.8xlarge",
    "c5d.9xlarge" : "c6id.12xlarge",
    "c5d.12xlarge" : "c6id.16xlarge",
    "c5d.18xlarge" : "c6id.24xlarge",
    "c5d.24xlarge" : "c6id.32xlarge",
    "c5d.metal" : "c6id.metal",
    
    //C5n:
    "c5n.large" : "c6in.xlarge",
    "c5n.xlarge" : "c6in.2xlarge",
    "c5n.2xlarge" : "c6in.4xlarge",
    "c5n.4xlarge" : "c6in.8xlarge",
    "c5n.9xlarge" : "c6in.12xlarge",
    "c5n.18xlarge" : "c6in.24xlarge",
    "c5n.metal" : "c6in.metal",
    
    //C6a:
    "c6a.large" : "c6a.xlarge",
    "c6a.xlarge" : "c6a.2xlarge",
    "c6a.2xlarge" : "c6a.4xlarge",
    "c6a.4xlarge" : "c6a.8xlarge",
    "c6a.8xlarge" : "c6a.12xlarge",
    "c6a.12xlarge" : "c6a.16xlarge",
    "c6a.16xlarge" : "c6a.24xlarge",
    "c6a.24xlarge" : "c6a.32xlarge",
    "c6a.32xlarge" : "c6a.48xlarge",
    "c6a.48xlarge" : "c6a.metal",
    "c6a.metal" : "c6a.metal",
    
    //C6g:
    "c6g.medium" : "c7g.large",
    "c6g.large" : "c7g.xlarge",
    "c6g.xlarge" : "c7g.2xlarge",
    "c6g.2xlarge" : "c7g.4xlarge",
    "c6g.4xlarge" : "c7g.8xlarge",
    "c6g.8xlarge" : "c7g.12xlarge",
    "c6g.12xlarge" : "c7g.16xlarge",
    "c6g.16xlarge" : "c7g.metal",
    "c6g.metal" : "c7g.large",
    
    //C6gd:
    "c6gd.medium" : "c6gd.large",
    "c6gd.large" : "c6gd.xlarge",
    "c6gd.xlarge" : "c6gd.2xlarge",
    "c6gd.2xlarge" : "c6gd.4xlarge",
    "c6gd.4xlarge" : "c6gd.8xlarge",
    "c6gd.8xlarge" : "c6gd.12xlarge",
    "c6gd.12xlarge" : "c6gd.16xlarge",
    "c6gd.16xlarge" : "c6gd.metal",
    "c6gd.metal" : "c6gd.metal",
    
    //C6gn:
    "c6gn.medium" : "c6gn.large", 
    "c6gn.large" : "c6gn.xlarge",
    "c6gn.xlarge" : "c6gn.2xlarge",
    "c6gn.2xlarge" : "c6gn.4xlarge",
    "c6gn.4xlarge" : "c6gn.8xlarge",
    "c6gn.8xlarge" : "c6gn.12xlarge",
    "c6gn.12xlarge" : "c6gn.16xlarge",
    "c6gn.16xlarge" : "c6gn.16xlarge",
    
    //C6i:
    "c6i.large" : "c6i.xlarge",
    "c6i.xlarge" : "c6i.2xlarge",
    "c6i.2xlarge" : "c6i.4xlarge",
    "c6i.4xlarge" : "c6i.8xlarge",
    "c6i.8xlarge" : "c6i.12xlarge",
    "c6i.12xlarge" : "c6i.16xlarge",
    "c6i.16xlarge" : "c6i.24xlarge",
    "c6i.24xlarge" : "c6i.32xlarge",
    "c6i.32xlarge" : "c6i.metal",
    "c6i.metal" : "c6i.metal",
    
    //C6id:
    "c6id.large" : "c6id.xlarge",
    "c6id.xlarge" : "c6id.2xlarge",
    "c6id.2xlarge" : "c6id.4xlarge",
    "c6id.4xlarge" : "c6id.8xlarge",
    "c6id.8xlarge" : "c6id.12xlarge",
    "c6id.12xlarge" : "c6id.16xlarge",
    "c6id.16xlarge" : "c6id.24xlarge",
    "c6id.24xlarge" : "c6id.32xlarge",
    "c6id.32xlarge" : "c6id.metal",
    "c6id.metal" : "c6id.metal",
    
    //C6in:
    "c6in.large" : "c6in.xlarge",
    "c6in.xlarge" : "c6in.2xlarge",
    "c6in.2xlarge" : "c6in.4xlarge",
    "c6in.4xlarge" : "c6in.8xlarge",
    "c6in.8xlarge" : "c6in.12xlarge",
    "c6in.12xlarge" : "c6in.16xlarge",
    "c6in.16xlarge" : "c6in.24xlarge",
    "c6in.24xlarge" : "c6in.32xlarge",
    "c6in.32xlarge" : "c6in.metal",
    "c6in.metal" : "c6in.metal",
    
    //C7g:
    "c7g.medium" : "c7g.large",
    "c7g.large" : "c7g.xlarge",
    "c7g.xlarge" : "c7g.2xlarge",
    "c7g.2xlarge" : "c7g.4xlarge",
    "c7g.4xlarge" : "c7g.8xlarge",
    "c7g.8xlarge" : "c7g.12xlarge",
    "c7g.12xlarge" : "c7g.16xlarge",
    "c7g.16xlarge" : "c7g.metal",
    "c7g.metal" : "c7g.metal",
    
    //CC2:
    "cc2.8xlarge" : "cc2.8xlarge",
    
    //Hpc6a:
    "hpc6a.48xlarge" : "hpc6a.48xlarge",

    //CR1:
    "cr1.8xlarge" : "cr1.8xlarge",
    
    //Hpc6id:
    "hpc6id.32xlarge" : "hpc6id.32xlarge",
    
    //R4:
    "r4.large" : "r6i.xlarge",
    "r4.xlarge" : "r6i.2xlarge",
    "r4.2xlarge" : "r6i.4xlarge",
    "r4.4xlarge" : "r6i.8xlarge",
    "r4.8xlarge" : "r6i.12xlarge",
    "r4.16xlarge" : "r6i.24xlarge",
    
    //R5:
    "r5.large" : "r6i.xlarge",
    "r5.xlarge" : "r6i.2xlarge",
    "r5.2xlarge" : "r6i.4xlarge",
    "r5.4xlarge" : "r6i.8xlarge",
    "r5.8xlarge" : "r6i.12xlarge",
    "r5.12xlarge" : "r6i.16xlarge",
    "r5.16xlarge" : "r6i.24xlarge",
    "r5.24xlarge" : "r6i.32xlarge",
    "r5.metal" : "r6i.metal",
    
    //R5a:
    "r5a.large" : "r6a.xlarge",
    "r5a.xlarge" : "r6a.2xlarge",
    "r5a.2xlarge" : "r6a.4xlarge",
    "r5a.4xlarge" : "r6a.8xlarge",
    "r5a.8xlarge" : "r6a.12xlarge",
    "r5a.12xlarge" : "r6a.16xlarge",
    "r5a.16xlarge" : "r6a.24xlarge",
    "r5a.24xlarge" : "r6a.32xlarge",
    
    //R5ad:
    "r5ad.large" : "r5ad.xlarge",
    "r5ad.xlarge" : "r5ad.2xlarge",
    "r5ad.2xlarge" : "r5ad.4xlarge",
    "r5ad.4xlarge" : "r5ad.8xlarge",
    "r5ad.8xlarge" : "r5ad.12xlarge",
    "r5ad.12xlarge" : "r5ad.16xlarge",
    "r5ad.16xlarge" : "r5ad.24xlarge",
    "r5ad.24xlarge" : "r5ad.24xlarge",
    
    //R5b:
    "r5b.large" : "r6i.xlarge",
    "r5b.xlarge" : "r6i.2xlarge",
    "r5b.2xlarge" : "r6i.4xlarge",
    "r5b.4xlarge" : "r6i.8xlarge",
    "r5b.8xlarge" : "r6i.12xlarge",
    "r5b.12xlarge" : "r6i.16xlarge",
    "r5b.16xlarge" : "r6i.24xlarge",
    "r5b.24xlarge" : "r6i.32xlarge",
    "r5b.metal" : "r6i.metal",
    
    //R5d:
    "r5d.large" : "r6id.xlarge",
    "r5d.xlarge" : "r6id.2xlarge",
    "r5d.2xlarge" : "r6id.4xlarge",
    "r5d.4xlarge" : "r6id.8xlarge",
    "r5d.8xlarge" : "r6id.12xlarge",
    "r5d.12xlarge" : "r6id.16xlarge",
    "r5d.16xlarge" : "r6id.24xlarge",
    "r5d.24xlarge" : "r6id.32xlarge",
    "r5d.metal" : "r6id.xlarge",
    
    //R5dn:
    "r5dn.large" : "r6idn.xlarge",
    "r5dn.xlarge" : "r6idn.2xlarge",
    "r5dn.2xlarge" : "r6idn.4xlarge",
    "r5dn.4xlarge" : "r6idn.8xlarge",
    "r5dn.8xlarge" : "r6idn.12xlarge",
    "r5dn.12xlarge" : "r6idn.16xlarge",
    "r5dn.16xlarge" : "r6idn.24xlarge",
    "r5dn.24xlarge" : "r6idn.32xlarge",
    "r5dn.metal" : "r6idn.metal",
    
    //R5n:
    "r5n.large" : "r6in.xlarge",
    "r5n.xlarge" : "r6in.2xlarge",
    "r5n.2xlarge" : "r6in.4xlarge",
    "r5n.4xlarge" : "r6in.8xlarge",
    "r5n.8xlarge" : "r6in.12xlarge",
    "r5n.12xlarge" : "r6in.16xlarge",
    "r5n.16xlarge" : "r6in.24xlarge",
    "r5n.24xlarge" : "r6in.32xlarge",
    "r5n.metal" : "r6in.metal",
    
    //R6a:
    "r6a.large" : "r6a.xlarge",
    "r6a.xlarge" : "r6a.2xlarge",
    "r6a.2xlarge" : "r6a.4xlarge",
    "r6a.4xlarge" : "r6a.8xlarge",
    "r6a.8xlarge" : "r6a.12xlarge",
    "r6a.12xlarge" : "r6a.16xlarge",
    "r6a.16xlarge" : "r6a.24xlarge",
    "r6a.24xlarge" : "r6a.32xlarge",
    "r6a.32xlarge" : "r6a.48xlarge",
    "r6a.48xlarge" : "r6a.metal",
    "r6a.metal" : "r6a.metal",
    
    //R6g:
    "r6g.medium" : "r7g.large",
    "r6g.large" : "r7g.xlarge",
    "r6g.xlarge" : "r7g.2xlarge",
    "r6g.2xlarge" : "r7g.4xlarge",
    "r6g.4xlarge" : "r7g.8xlarge",
    "r6g.8xlarge" : "r7g.12xlarge",
    "r6g.12xlarge" : "r7g.16xlarge",
    "r6g.16xlarge" : "r7g.metal",
    "r6g.metal" : "r7g.metal",
    
    //R6gd:
    "r6gd.medium" : "r6gd.large",
    "r6gd.large" : "r6gd.xlarge",
    "r6gd.xlarge" : "r6gd.2xlarge",
    "r6gd.2xlarge" : "r6gd.4xlarge",
    "r6gd.4xlarge" : "r6gd.8xlarge",
    "r6gd.8xlarge" : "r6gd.12xlarge",
    "r6gd.12xlarge" : "r6gd.16xlarge",
    "r6gd.16xlarge" : "r6gd.metal",
    "r6gd.metal" : "r6gd.metal",
    
    //R6i:
    "r6i.large" : "r6i.xlarge",
    "r6i.xlarge" : "r6i.2xlarge",
    "r6i.2xlarge" : "r6i.4xlarge",
    "r6i.4xlarge" : "r6i.8xlarge",
    "r6i.8xlarge" : "r6i.12xlarge",
    "r6i.12xlarge" : "r6i.16xlarge",
    "r6i.16xlarge" : "r6i.24xlarge",
    "r6i.24xlarge" : "r6i.32xlarge",
    "r6i.32xlarge" : "r6i.metal",
    "r6i.metal" : "r6i.metal",
    
    //R6idn:
    "r6idn.large" : "r6idn.xlarge",
    "r6idn.xlarge" : "r6idn.2xlarge",
    "r6idn.2xlarge" : "r6idn.4xlarge",
    "r6idn.4xlarge" : "r6idn.8xlarge",
    "r6idn.8xlarge" : "r6idn.12xlarge",
    "r6idn.12xlarge" : "r6idn.16xlarge",
    "r6idn.16xlarge" : "r6idn.24xlarge",
    "r6idn.24xlarge" : "r6idn.32xlarge",
    "r6idn.32xlarge" : "r6idn.metal",
    "r6idn.metal" : "r6idn.metal",
    
    //R6in:
    "r6in.large" : "r6in.xlarge",
    "r6in.xlarge" : "r6in.2xlarge",
    "r6in.2xlarge" : "r6in.4xlarge",
    "r6in.4xlarge" : "r6in.8xlarge",
    "r6in.8xlarge" : "r6in.12xlarge",
    "r6in.12xlarge" : "r6in.16xlarge",
    "r6in.16xlarge" : "r6in.24xlarge",
    "r6in.24xlarge" : "r6in.32xlarge",
    "r6in.32xlarge" : "r6in.metal",
    "r6in.metal" : "r6in.metal",
    
    //R6id:
    "r6id.large" : "r6id.xlarge",
    "r6id.xlarge" : "r6id.2xlarge",
    "r6id.2xlarge" : "r6id.4xlarge",
    "r6id.4xlarge" : "r6id.8xlarge",
    "r6id.8xlarge" : "r6id.12xlarge",
    "r6id.12xlarge" : "r6id.16xlarge",
    "r6id.16xlarge" : "r6id.24xlarge",
    "r6id.24xlarge" : "r6id.32xlarge",
    "r6id.32xlarge" : "r6id.metal",
    "r6id.metal" : "r6id.metal",
    
    //R7g: 
    "r7g.medium" : "r7g.large",
    "r7g.large" : "r7g.xlarge",
    "r7g.xlarge" : "r7g.2xlarge",
    "r7g.2xlarge" : "r7g.4xlarge",
    "r7g.4xlarge" : "r7g.8xlarge",
    "r7g.8xlarge" : "r7g.12xlarge",
    "r7g.12xlarge" : "r7g.16xlarge",
    "r7g.16xlarge" : "r7g.metal",
    "r7g.metal" : "r7g.metal",
    
    //z1d:
    "z1d.large" : "z1d.xlarge",
    "z1d.xlarge" : "z1d.2xlarge",
    "z1d.2xlarge" : "z1d.3xlarge",
    "z1d.3xlarge" : "z1d.6xlarge",
    "z1d.6xlarge" : "z1d.12xlarge",
    "z1d.12xlarge" : "z1d.metal",
    "z1d.metal" : "z1d.metal",

    //D2:
    "d2.xlarge" : "d3.2xlarge",
    "d2.2xlarge" : "d3.4xlarge",
    "d2.4xlarge" : "d3.8xlarge",
    "d2.8xlarge" : "d3.8xlarge",

    //D3:
    "d3.xlarge" : "d3.2xlarge",
    "d3.2xlarge" : "d3.4xlarge",
    "d3.4xlarge" : "d3.8xlarge",
    "d3.8xlarge" : "d3.8xlarge",

    //D3en:
    "d3en.xlarge" : "d3en.2xlarge",
    "d3en.2xlarge" : "d3en.4xlarge",
    "d3en.4xlarge" : "d3en.6xlarge",
    "d3en.6xlarge" : "d3en.8xlarge",
    "d3en.8xlarge" : "d3en.12xlarge",
    "d3en.12xlarge" : "d3en.12xlarge",

    //H1:
    "h1.2xlarge" : "h1.4xlarge",
    "h1.4xlarge" : "h1.8xlarge",
    "h1.8xlarge" : "h1.16xlarge",
    "h1.16xlarge" : "h1.16xlarge",

    //I3:
    "i3.large" : "i4i.xlarge",
    "i3.xlarge" : "i4i.2xlarge",
    "i3.2xlarge" : "i4i.4xlarge",
    "i3.4xlarge" : "i4i.8xlarge",
    "i3.8xlarge" : "i4i.16xlarge",
    "i3.16xlarge" : "i4i.32xlarge",
    "i3.metal" : "i4i.metal",

    //I3en:
    "i3en.large" : "i4i.xlarge",
    "i3en.xlarge" : "i4i.2xlarge",
    "i3en.2xlarge" : "i4i.4xlarge",
    "i3en.3xlarge" : "i4i.4xlarge",
    "i3en.6xlarge" : "i4i.8xlarge",
    "i3en.12xlarge" : "i4i.16xlarge",
    "i3en.24xlarge" : "i4i.32xlarge",
    "i3en.metal" : "i4i.metal",

    //I4g:
    "i4g.large" : "i4g.xlarge",
    "i4g.xlarge" : "i4g.2xlarge",
    "i4g.2xlarge" : "i4g.4xlarge",
    "i4g.4xlarge" : "i4g.8xlarge",
    "i4g.8xlarge" : "i4g.16xlarge",
    "i4g.16xlarge" : "i4g.16xlarge",

    //I4i:
    "i4i.large" : "i4i.xlarge",
    "i4i.xlarge" : "i4i.2xlarge",
    "i4i.2xlarge" : "i4i.4xlarge",
    "i4i.4xlarge" : "i4i.8xlarge",
    "i4i.8xlarge" : "i4i.16xlarge",
    "i4i.16xlarge" : "i4i.32xlarge",
    "i4i.32xlarge" : "i4i.metal",
    "i4i.metal" : "i4i.metal",

    //Im4gn:
    "im4gn.large" : "im4gn.xlarge",
    "im4gn.xlarge" : "im4gn.2xlarge",
    "im4gn.2xlarge" : "im4gn.4xlarge",
    "im4gn.4xlarge" : "im4gn.8xlarge",
    "im4gn.8xlarge" : "im4gn.16xlarge",
    "im4gn.16xlarge" : "im4gn.16xlarge",

    //Is4gen:
    "is4gen.medium" : "is4gen.large",
    "is4gen.large" : "is4gen.xlarge",
    "is4gen.xlarge" : "is4gen.2xlarge",
    "is4gen.2xlarge" : "is4gen.4xlarge",
    "is4gen.4xlarge" : "is4gen.8xlarge",
    "is4gen.8xlarge" : "is4gen.8xlarge",

    //DL1:
    "dl1.24xlarge" : "",

    //F1:
    "f1.2xlarge" : "",
    "f1.4xlarge" : "",
    "f1.16xlarge" : "",

    //G3:
    "g3.4xlarge" : "g5.8xlarge",
    "g3.8xlarge" : "g5.12xlarge",
    "g3.16xlarge" : "g5.24xlarge",

    //G4ad:
    "g4ad.xlarge" : "g4ad.2xlarge",
    "g4ad.2xlarge" : "g4ad.4xlarge",
    "g4ad.4xlarge" : "g4ad.8xlarge",
    "g4ad.8xlarge" : "g4ad.16xlarge",
    "g4ad.16xlarge" : "g4ad.16xlarge",

    //G4dn:
    "g4dn.xlarge" : "g4dn.2xlarge",
    "g4dn.2xlarge" : "g4dn.4xlarge",
    "g4dn.4xlarge" : "g4dn.8xlarge",
    "g4dn.8xlarge" : "g4dn.12xlarge",
    "g4dn.12xlarge" : "g4dn.16xlarge",
    "g4dn.16xlarge" : "g4dn.metal",
    "g4dn.metal" : "g4dn.metal",

    //G5:
    "g5.xlarge" : "g5.2xlarge",
    "g5.2xlarge" : "g5.4xlarge",
    "g5.4xlarge" : "g5.8xlarge",
    "g5.8xlarge" : "g5.12xlarge",
    "g5.12xlarge" : "g5.16xlarge",
    "g5.16xlarge" : "g5.24xlarge",
    "g5.24xlarge" : "g5.48xlarge",
    "g5.48xlarge" : "g5.48xlarge",

    //G5g:
    "g5g.xlarge" : "g5g.2xlarge",
    "g5g.2xlarge" : "g5g.4xlarge",
    "g5g.4xlarge" : "g5g.8xlarge",
    "g5g.8xlarge" : "g5g.16xlarge",
    "g5g.16xlarge" : "g5g.metal",
    "g5g.metal" : "g5g.metal",

    //Inf1:
    "inf1.xlarge" : "inf1.2xlarge",
    "inf1.2xlarge" : "inf1.6xlarge",
    "inf1.6xlarge" : "inf2.8xlarge",
    "inf1.24xlarge" : "inf2.48xlarge",

    //Inf2:
    "inf2.xlarge" : "inf2.8xlarge",
    "inf2.8xlarge" : "inf2.24xlarge",
    "inf2.24xlarge" : "inf2@48xlarge",
    "inf2.48xlarge" : "inf2.48xlarge",

    //P2:
    "p2.xlarge" : "p3.2xlarge",
    "p2.8xlarge" : "p3.16xlarge",
    "p2.16xlarge" : "p3.16xlarge",

    //P3:
    "p3.2xlarge" : "p3.8xlarge",
    "p3.8xlarge" : "p3.16xlarge",
    "p3.16xlarge" : "p3.16xlarge",

    // //P3dn:
    // "p3dn.24xlarge" : "",

    // //P4d:
    // "p4d.24xlarge" : "",

    // //P4de:
    // "p4de.24xlarge" : "",

    // //Trn1:
    // "trn1.2xlarge" : "",
    // "trn1.32xlarge" : "",

    // //Trn1n:
    // "trn1n.32xlarge" : "",

    //VT1:
    "vt1.3xlarge" : "vt1.6xlarge",
    "vt1.6xlarge" : "vt1.24xlarge",
    "vt1.24xlarge" : "vt1.24xlarge"
  }

  // 현재 인스턴스 타입이 매핑 테이블에 있는지 확인하고, 상위 인스턴스 타입을 반환합니다.
  if (instanceTypeMap.hasOwnProperty(currentInstanceType)) {
    return instanceTypeMap[currentInstanceType];
  }

  // 매핑 테이블에 없는 경우, 직전 인스턴스 타입을 반환하거나 다른 로직을 추가할 수 있습니다.
  return currentInstanceType;
}
function proposeLowerInstanceType(currentInstanceType) {
  const instanceTypeMap = {
    //M4
    "m4.large" : "m6i.large",
    "m4.xlarge" : "m6i.large",
    "m4.2xlarge" : "m6i.xlarge",
    "m4.4xlarge" : "m6i.2xlarge",
    "m4.10xlarge" : "m6i.4xlarge",
    "m4.16xlarge" : "m6i.8xlarge",
    //M5
    "m5.large" : "m6i.large",
    "m5.xlarge" : "m6i.large",
    "m5.2xlarge" : "m6i.xlarge",
    "m5.4xlarge" : "m6i.2xlarge",
    "m5.8xlarge" : "m6i.4xlarge",
    "m5.12xlarge" : "m6i.8xlarge",
    "m5.16xlarge" : "m6i.12xlarge",
    "m5.24xlarge" : "m6i.16xlarge",
    "m5.metal" : "m6i.32xlarge",
    //M5a
    "m5a.large" : "m6a.large",
    "m5a.xlarge" : "m6a.large",
    "m5a.2xlarge" : "m6a.xlarge",
    "m5a.4xlarge" : "m6a.2xlarge",
    "m5a.8xlarge" : "m6a.4xlarge",
    "m5a.12xlarge" : "m6a.8xlarge",
    "m5a.16xlarge" : "m6a.12xlarge",
    "m5a.24xlarge" : "m6a.16xlarge",
    //M5ad
    "m5ad.large" : "m6a.large",
    "m5ad.xlarge" : "m6a.large",
    "m5ad.2xlarge" : "m6a.xlarge",
    "m5ad.4xlarge" : "m6a.2xlarge",
    "m5ad.8xlarge" : "m6a.4xlarge",
    "m5ad.12xlarge" : "m6a.8xlarge",
    "m5ad.16xlarge" : "m6a.12xlarge",
    "m5ad.24xlarge" : "m6a.16xlarge",
    //M5d
    "m5d.large" : "m6id.large",
    "m5d.xlarge" : "m6id.large",
    "m5d.2xlarge" : "m6id.xlarge",
    "m5d.4xlarge" : "m6id.2xlarge",
    "m5d.8xlarge" : "m6id.4xlarge",
    "m5d.12xlarge" : "m6id.8xlarge",
    "m5d.16xlarge" : "m6id.12xlarge",
    "m5d.24xlarge" : "m6id.16xlarge",
    "m5d.metal" : "m6id.xlarge",
    //M5dn
    "m5dn.large" : "m6idn.large",
    "m5dn.xlarge" : "m6idn.large",
    "m5dn.2xlarge" : "m6idn.xlarge",
    "m5dn.4xlarge" : "m6idn.2xlarge",
    "m5dn.8xlarge" : "m6idn.4xlarge",
    "m5dn.12xlarge" : "m6idn.8xlarge",
    "m5dn.16xlarge" : "m6idn.12xlarge",
    "m5dn.24xlarge" : "m6idn.16xlarge",
    "m5dn.metal" : "m6idn.32xlarge",
    //M5n
    "m5n.large" : "m6in.large",
    "m5n.xlarge" : "m6idn.large",
    "m5n.2xlarge" : "m6idn.xlarge",
    "m5n.4xlarge" : "m6idn.2xlarge",
    "m5n.8xlarge" : "m6idn.4xlarge",
    "m5n.12xlarge" : "m6idn.8xlarge",
    "m5n.16xlarge" : "m6idn.12xlarge",
    "m5n.24xlarge" : "m6idn.16xlarge",
    "m5n.metal" : "m6idn.32xlarge",
    //M5zn
    "m5zn.large" : "m6in.large",
    "m5zn.xlarge" : "m6in.large",
    "m5zn.2xlarge" : "m6in.xlarge",
    "m5zn.3xlarge" : "m6in.2xlarge",
    "m5zn.6xlarge" : "m6in.4xlarge",
    "m5zn.12xlarge" : "m6in.8xlarge",
    "m5zn.metal" : "m6in.xlarge",
    //M6a
    "m6a.large" : "m6a.large",
    "m6a.xlarge" : "m6a.large",
    "m6a.2xlarge" : "m6a.xlarge",
    "m6a.4xlarge" : "m6a.2xlarge",
    "m6a.8xlarge" : "m6a.4xlarge",
    "m6a.12xlarge" : "m6a.8xlarge",
    "m6a.16xlarge" : "m6a.12xlarge",
    "m6a.24xlarge" : "m6a.16xlarge",
    "m6a.32xlarge" : "m6a.24xlarge",
    "m6a.48xlarge" : "m6a.32xlarge",
    "m6a.metal" : "m6a.48xlarge",
    //M6g
    "m6g.medium" : "m7g.medium",
    "m6g.large" : "m7g.medium",
    "m6g.xlarge" : "m7g.large",
    "m6g.2xlarge" : "m7g.xlarge",
    "m6g.4xlarge" : "m7g.2xlarge",
    "m6g.8xlarge" : "m7g.4xlarge",
    "m6g.12xlarge" : "m7g.8xlarge",
    "m6g.16xlarge" : "m7g.12xlarge",
    "m6g.metal" : "m7g.16xlarge",
    //M6gd
    "m6gd.medium" : "m6gd.medium",
    "m6gd.large" : "m6gd.medium",
    "m6gd.xlarge" : "m6gd.large",
    "m6gd.2xlarge" : "m6gd.xlarge",
    "m6gd.4xlarge" : "m6gd.2xlarge",
    "m6gd.8xlarge" : "m6gd.4xlarge",
    "m6gd.12xlarge" : "m6gd.8xlarge",
    "m6gd.16xlarge" : "m6gd.12xlarge",
    "m6gd.metal" : "m6gd.16xlarge",
    //M6i
    "m6i.large" : "m6i.large",
    "m6i.xlarge" : "m6i.large",
    "m6i.2xlarge" : "m6i.xlarge",
    "m6i.4xlarge" : "m6i.2xlarge",
    "m6i.8xlarge" : "m6i.4xlarge",
    "m6i.12xlarge" : "m6i.8xlarge",
    "m6i.16xlarge" : "m6i.12xlarge",
    "m6i.24xlarge" : "m6i.16xlarge",
    "m6i.32xlarge" : "m6i.24xlarge",
    "m6i.metal" : "m6i.32xlarge",
    //M6id
    "m6id.large" : "m6id.large",
    "m6id.xlarge" : "m6id.large",
    "m6id.2xlarge" : "m6id.xlarge",
    "m6id.4xlarge" : "m6id.xlarge",
    "m6id.8xlarge" : "m6id.xlarge",
    "m6id.12xlarge" : "m6id.xlarge",
    "m6id.16xlarge" : "m6id.xlarge",
    "m6id.24xlarge" : "m6id.xlarge",
    "m6id.32xlarge" : "m6id.xlarge",
    "m6id.metal" : "m6id.xlarge",
    //M6idn
    "m6idn.large" : "m6idn.large",
    "m6idn.xlarge" : "m6idn.large",
    "m6idn.2xlarge" : "m6idn.xlarge",
    "m6idn.4xlarge" : "m6idn.2xlarge",
    "m6idn.8xlarge" : "m6idn.4xlarge",
    "m6idn.12xlarge" : "m6idn.8xlarge",
    "m6idn.16xlarge" : "m6idn.12xlarge",
    "m6idn.24xlarge" : "m6idn.16xlarge",
    "m6idn.32xlarge" : "m6idn.24xlarge",
    "m6idn.metal" : "m6idn.32xlarge",
    //M6in
    "m6in.large" : "m6in.large",
    "m6in.xlarge" : "m6in.large",
    "m6in.2xlarge" : "m6in.xlarge",
    "m6in.4xlarge" : "m6in.2xlarge",
    "m6in.8xlarge" : "m6in.4xlarge",
    "m6in.12xlarge" : "m6in.8xlarge",
    "m6in.16xlarge" : "m6in.12xlarge",
    "m6in.24xlarge" : "m6in.16xlarge",
    "m6in.32xlarge" : "m6in.24xlarge",
    "m6in.metal" : "m6in.32xlarge",
    //M7g
    "m7g.medium" : "m7g.medium",
    "m7g.large" : "m7g.medium",
    "m7g.xlarge" : "m7g.large",
    "m7g.2xlarge" : "m7g.xlarge",
    "m7g.4xlarge" : "m7g.2xlarge",
    "m7g.8xlarge" : "m7g.4xlarge",
    "m7g.12xlarge" : "m7g.8xlarge",
    "m7g.16xlarge" : "m7g.12xlarge",
    "m7g.metal" : "m7g.16xlarge",
    //Mac1
    // "mac1.metal" : "",
    // //Mac2
    // "mac2.metal" : "",
    //T2
    "t2.nano" : "t3.nano",
    "t2.micro" : "t3.micro",
    "t2.small" : "t3.micro",
    "t2.medium" : "t3.small",
    "t2.large" : "t3.medium",
    "t2.xlarge" : "t3.large",
    "t2.2xlarge" : "t3.xlarge",
    //T3
    "t3.nano" : "t3.nano",
    "t3.micro" : "t3.micro",
    "t3.small" : "t3.micro",
    "t3.medium" : "t3.small",
    "t3.large" : "t3.medium",
    "t3.xlarge" : "t3.large",
    "t3.2xlarge" : "t3.xlarge",
    //T3a
    "t3a.nano" : "t3a.nano",
    "t3a.micro" : "t3a.micro",
    "t3a.small" : "t3a.micro",
    "t3a.medium" : "t3a.small",
    "t3a.large" : "t3a.medium",
    "t3a.xlarge" : "t3a.large",
    "t3a.2xlarge" : "t3a.xlarge",
    //T4g
    "t4g.nano" : "t4g.nano",
    "t4g.micro" : "t4g.micro",
    "t4g.small" : "t4g.micro",
    "t4g.medium" : "t4g.small",
    "t4g.large" : "t4g.medium",
    "t4g.xlarge" : "t4g.large",
    "t4g.2xlarge" : "t4g.xlarge",
    //C4
    "c4.large" : "c6i.large",
    "c4.xlarge" : "c6i.large",
    "c4.2xlarge" : "c6i.xlarge",
    "c4.4xlarge" : "c6i.2xlarge",
    "c4.8xlarge" : "c6i.4xlarge",
    //C5
    "c5.large" : "c6i.large",
    "c5.xlarge" : "c6i.large",
    "c5.2xlarge" : "c6i.xlarge",
    "c5.4xlarge" : "c6i.2xlarge",
    "c5.9xlarge" : "c6i.4xlarge",
    "c5.12xlarge" : "c6i.8xlarge",
    "c5.18xlarge" : "c6i.12xlarge",
    "c5.24xlarge" : "c6i.16xlarge",
    "c5.metal" : "c6i.32xlarge",
    //C5a
    "c5a.large" : "c6a.large",
    "c5a.xlarge" : "c6a.large",
    "c5a.2xlarge" : "c6a.xlarge",
    "c5a.4xlarge" : "c6a.2xlarge",
    "c5a.8xlarge" : "c6a.4xlarge",
    "c5a.12xlarge" : "c6a.8xlarge",
    "c5a.16xlarge" : "c6a.12xlarge",
    "c5a.24xlarge" : "c6a.16xlarge",
    //C5ad
    "c5ad.large" : "c5ad.large",
    "c5ad.xlarge" : "c5ad.large",
    "c5ad.2xlarge" : "c5ad.xlarge",
    "c5ad.4xlarge" : "c5ad.2xlarge",
    "c5ad.8xlarge" : "c5ad.4xlarge",
    "c5ad.12xlarge" : "c5ad.8xlarge",
    "c5ad.16xlarge" : "c5ad.12xlarge",
    "c5ad.24xlarge" : "c5ad.16xlarge",
    //C5d
    "c5d.large" : "c6id.large",
    "c5d.xlarge" : "c6id.large",
    "c5d.2xlarge" : "c6id.xlarge",
    "c5d.4xlarge" : "c6id.2xlarge",
    "c5d.9xlarge" : "c6id.4xlarge",
    "c5d.12xlarge" : "c6id.8xlarge",
    "c5d.18xlarge" : "c6id.12xlarge",
    "c5d.24xlarge" : "c6id.16xlarge",
    "c5d.metal" : "c6id.32xlarge",
    //C5n
    "c5n.large" : "c6in.large",
    "c5n.xlarge" : "c6in.large",
    "c5n.2xlarge" : "c6in.xlarge",
    "c5n.4xlarge" : "c6in.2xlarge",
    "c5n.9xlarge" : "c6in.4xlarge",
    "c5n.18xlarge" : "c6in.8xlarge",
    "c5n.metal" : "c6in.32xlarge",
    //C6a
    "c6a.large" : "c6a.large",
    "c6a.xlarge" : "c6a.large",
    "c6a.2xlarge" : "c6a.xlarge",
    "c6a.4xlarge" : "c6a.2xlarge",
    "c6a.12xlarge" : "c6a.4xlarge",
    "c6a.16xlarge" : "c6a.8xlarge",
    "c6a.24xlarge" : "c6a.12xlarge",
    "c6a.32xlarge" : "c6a.16xlarge",
    "c6a.48xlarge" : "c6a.24xlarge",
    "c6a.metal" : "c6a.48xlarge",
    //C6g
    "c6g.medium" : "c6g.medium",
    "c6g.large" : "c6g.medium",
    "c6g.xlarge" : "c6g.large",
    "c6g.2xlarge" : "c6g.xlarge",
    "c6g.4xlarge" : "c6g.2xlarge",
    "c6g.8xlarge" : "c6g.4xlarge",
    "c6g.12xlarge" : "c6g.8xlarge",
    "c6g.16xlarge" : "c6g.12xlarge",
    "c6g.metal" : "c6g.16xlarge",
    //C6gd
    "c6gd.medium" : "c6gd.medium",
    "c6gd.large" : "c6gd.medium",
    "c6gd.xlarge" : "c6gd.large",
    "c6gd.2xlarge" : "c6gd.xlarge",
    "c6gd.4xlarge" : "c6gd.2xlarge",
    "c6gd.8xlarge" : "c6gd.4xlarge",
    "c6gd.12xlarge" : "c6gd.8xlarge",
    "c6gd.16xlarge" : "c6gd.12xlarge",
    "c6gd.metal" : "c6gd.16xlarge",
    //C6gn
    "c6gn.medium" : "c6gn.medium",
    "c6gn.large" : "c6gn.medium",
    "c6gn.xlarge" : "c6gn.large",
    "c6gn.2xlarge" : "c6gn.xlarge",
    "c6gn.4xlarge" : "c6gn.2xlarge",
    "c6gn.8xlarge" : "c6gn.4xlarge",
    "c6gn.12xlarge" : "c6gn.8xlarge",
    "c6gn.16xlarge" : "c6gn.12xlarge",
    //C6i
    "c6i.large" : "c6i.large",
    "c6i.xlarge" : "c6i.large",
    "c6i.2xlarge" : "c6i.xlarge",
    "c6i.4xlarge" : "c6i.2xlarge",
    "c6i.8xlarge" : "c6i.4xlarge",
    "c6i.12xlarge" : "c6i.8xlarge",
    "c6i.16xlarge" : "c6i.12xlarge",
    "c6i.24xlarge" : "c6i.16xlarge",
    "c6i.32xlarge" : "c6i.24xlarge",
    "c6i.metal" : "c6i.32xlarge",
    //C6id
    "c6id.large" : "c6id.large",
    "c6id.xlarge" : "c6id.large",
    "c6id.2xlarge" : "c6id.xlarge",
    "c6id.4xlarge" : "c6id.2xlarge",
    "c6id.8xlarge" : "c6id.4xlarge",
    "c6id.12xlarge" : "c6id.8xlarge",
    "c6id.16xlarge" : "c6id.12xlarge",
    "c6id.24xlarge" : "c6id.16xlarge",
    "c6id.32xlarge" : "c6id.24xlarge",
    "c6id.metal" : "c6id.32xlarge",
    //C6in
    "c6in.large" : "c6in.large",
    "c6in.xlarge" : "c6in.large",
    "c6in.2xlarge" : "c6in.xlarge",
    "c6in.4xlarge" : "c6in.2xlarge",
    "c6in.8xlarge" : "c6in.4xlarge",
    "c6in.12xlarge" : "c6in.8xlarge",
    "c6in.16xlarge" : "c6in.12xlarge",
    "c6in.24xlarge" : "c6in.16xlarge",
    "c6in.32xlarge" : "c6in.24xlarge",
    "c6in.metal" : "c6in.32xlarge",
    //C7g
    "c7g.medium" : "c7g.medium",
    "c7g.large" : "c7g.medium",
    "c7g.xlarge" : "c7g.large",
    "c7g.2xlarge" : "c7g.xlarge",
    "c7g.4xlarge" : "c7g.2xlarge",
    "c7g.8xlarge" : "c7g.4xlarge",
    "c7g.12xlarge" : "c7g.8xlarge",
    "c7g.16xlarge" : "c7g.12xlarge",
    "c7g.metal" : "c7g.16xlarge",
    // //CC2
    // "cc2.8xlarge" : "",
    // //Hpc6a
    // "hpc6a.48xlarge" : "",
    // //CR1
    // "cr1.8xlarge" : "",
    // //Hpc6id
    // "hpc6id.32xlarge" : "",
    //R4
    "r4.large" : "r6i.large",
    "r4.xlarge" : "r6i.large",
    "r4.2xlarge" : "r6i.xlarge",
    "r4.4xlarge" : "r6i.2xlarge",
    "r4.8xlarge" : "r6i.4xlarge",
    "r4.16xlarge" : "r6i.8xlarge",
    //R5
    "r5.large" : "r6i.large",
    "r5.xlarge" : "r6i.large",
    "r5.2xlarge" : "r6i.xlarge",
    "r5.4xlarge" : "r6i.2xlarge",
    "r5.8xlarge" : "r6i.4xlarge",
    "r5.12xlarge" : "r6i.8xlarge",
    "r5.16xlarge" : "r6i.12xlarge",
    "r5.24xlarge" : "r6i.16xlarge",
    "r5.metal" : "r6i.32xlarge",
    //R5a
    "r5a.large" : "r6a.large",
    "r5a.xlarge" : "r6.large",
    "r5a.2xlarge" : "r6a.xlarge",
    "r5a.4xlarge" : "r6a.2xlarge",
    "r5a.8xlarge" : "r6a.4xlarge",
    "r5a.12xlarge" : "r6a.8xlarge",
    "r5a.16xlarge" : "r6a.12xlarge",
    "r5a.24xlarge" : "r6a.16xlarge",
    //R5ad
    "r5ad.large" : "r5ad.large",
    "r5ad.xlarge" : "r5ad.large",
    "r5ad.2xlarge" : "r5ad.xlarge",
    "r5ad.4xlarge" : "r5ad.2xlarge",
    "r5ad.8xlarge" : "r5ad.4xlarge",
    "r5ad.12xlarge" : "r5ad.8xlarge",
    "r5ad.16xlarge" : "r5ad.12xlarge",
    "r5ad.24xlarge" : "r5ad.16xlarge",
    //R5b
    "r5b.large" : "r6i.large",
    "r5b.xlarge" : "r6i.large",
    "r5b.2xlarge" : "r6i.xlarge",
    "r5b.4xlarge" : "r6i.2xlarge",
    "r5b.8xlarge" : "r6i.4xlarge",
    "r5b.12xlarge" : "r6i.8xlarge",
    "r5b.16xlarge" : "r6i.12xlarge",
    "r5b.24xlarge" : "r6i.16xlarge",
    "r5b.metal" : "r6i.32xlarge",
    //R5d
    "r5d.large" : "r6id.large",
    "r5d.xlarge" : "r6id.large",
    "r5d.2xlarge" : "r6id.xlarge",
    "r5d.4xlarge" : "r6id.2xlarge",
    "r5d.8xlarge" : "r6id.4xlarge",
    "r5d.12xlarge" : "r6id.8xlarge",
    "r5d.16xlarge" : "r6id.12xlarge",
    "r5d.24xlarge" : "r6id.16xlarge",
    "r5d.metal" : "r6id.xlarge",
    //R5dn
    "r5dn.large" : "r6idn.large",
    "r5dn.xlarge" : "r6idn.large",
    "r5dn.2xlarge" : "r6idn.xlarge",
    "r5dn.4xlarge" : "r6idn.2xlarge",
    "r5dn.8xlarge" : "r6idn.4xlarge",
    "r5dn.12xlarge" : "r6idn.8xlarge",
    "r5dn.16xlarge" : "r6idn.12xlarge",
    "r5dn.24xlarge" : "r6idn.16xlarge",
    "r5dn.metal" : "r6idn.32xlarge",
    //R5n
    "r5n.large" : "r6in.large",
    "r5n.xlarge" : "r6in.large",
    "r5n.2xlarge" : "r6in.xlarge",
    "r5n.4xlarge" : "r6in.2xlarge",
    "r5n.8xlarge" : "r6in.4xlarge",
    "r5n.12xlarge" : "r6in.8xlarge",
    "r5n.16xlarge" : "r6in.12xlarge",
    "r5n.24xlarge" : "r6in.16xlarge",
    "r5n.metal" : "r6in.32xlarge",
    //R6a
    "r6a.large" : "r6a.large",
    "r6a.xlarge" : "r6a.large",
    "r6a.2xlarge" : "r6a.xlarge",
    "r6a.4xlarge" : "r6a.2xlarge",
    "r6a.8xlarge" : "r6a.4xlarge",
    "r6a.12xlarge" : "r6a.8xlarge",
    "r6a.16xlarge" : "r6a.12xlarge",
    "r6a.24xlarge" : "r6a.16xlarge",
    "r6a.32xlarge" : "r6a.24xlarge",
    "r6a.48xlarge" : "r6a.32xlarge",
    "r6a.metal" : "r6a.48xlarge",
    //R6g
    "r6g.medium" : "r6g.medium",
    "r6g.large" : "r6g.medium",
    "r6g.xlarge" : "r6g.large",
    "r6g.2xlarge" : "r6g.xlarge",
    "r6g.4xlarge" : "r6g.2xlarge",
    "r6g.8xlarge" : "r6g.4xlarge",
    "r6g.12xlarge" : "r6g.8xlarge",
    "r6g.16xlarge" : "r6g.12xlarge",
    "r6g.metal" : "r6g.16xlarge",
    //R6gd
    "r6gd.medium" : "r6gd.medium",
    "r6gd.large" : "r6gd.medium",
    "r6gd.xlarge" : "r6gd.large",
    "r6gd.2xlarge" : "r6gd.xlarge",
    "r6gd.4xlarge" : "r6gd.2xlarge",
    "r6gd.8xlarge" : "r6gd.4xlarge",
    "r6gd.12xlarge" : "r6gd.8xlarge",
    "r6gd.16xlarge" : "r6gd.12xlarge",
    "r6gd.metal" : "r6gd.16xlarge",
    //R6i
    "r6i.large" : "r6i.large",
    "r6i.xlarge" : "r6i.large",
    "r6i.2xlarge" : "r6i.xlarge",
    "r6i.4xlarge" : "r6i.2xlarge",
    "r6i.8xlarge" : "r6i.4xlarge",
    "r6i.12xlarge" : "r6i.8xlarge",
    "r6i.16xlarge" : "r6i.12xlarge",
    "r6i.24xlarge" : "r6i.16xlarge",
    "r6i.32xlarge" : "r6i.24xlarge",
    "r6i.metal" : "r6i.32xlarge",
    //R6idn
    "r6idn.large" : "r6idn.large",
    "r6idn.xlarge" : "r6idn.large",
    "r6idn.2xlarge" : "r6idn.xlarge",
    "r6idn.4xlarge" : "r6idn.2xlarge",
    "r6idn.8xlarge" : "r6idn.4xlarge",
    "r6idn.12xlarge" : "r6idn.8xlarge",
    "r6idn.16xlarge" : "r6idn.12xlarge",
    "r6idn.24xlarge" : "r6idn.16xlarge",
    "r6idn.32xlarge" : "r6idn.24xlarge",
    "r6idn.metal" : "r6idn.32xlarge",
    //R6in
    "r6in.large" : "r6in.large",
    "r6in.xlarge" : "r6in.large",
    "r6in.2xlarge" : "r6in.xlarge",
    "r6in.4xlarge" : "r6in.2xlarge",
    "r6in.8xlarge" : "r6in.4xlarge",
    "r6in.12xlarge" : "r6in.8xlarge",
    "r6in.16xlarge" : "r6in.12xlarge",
    "r6in.24xlarge" : "r6in.16xlarge",
    "r6in.32xlarge" : "r6in.24xlarge",
    "r6in.metal" : "r6in.32xlarge",
    //R6id
    "r6id.large" : "r6id.large",
    "r6id.xlarge" : "r6id.large",
    "r6id.2xlarge" : "r6id.xlarge",
    "r6id.4xlarge" : "r6id.2xlarge",
    "r6id.8xlarge" : "r6id.4xlarge",
    "r6id.12xlarge" : "r6id.8xlarge",
    "r6id.16xlarge" : "r6id.12xlarge",
    "r6id.24xlarge" : "r6id.16xlarge",
    "r6id.32xlarge" : "r6id.24xlarge",
    "r6id.metal" : "r6id.32xlarge",
    //R7g
    "r7g.medium" : "r7g.medium",
    "r7g.large" : "r7g.medium",
    "r7g.xlarge" : "r7g.large",
    "r7g.2xlarge" : "r7g.xlarge",
    "r7g.4xlarge" : "r7g.2xlarge",
    "r7g.8xlarge" : "r7g.4xlarge",
    "r7g.12xlarge" : "r7g.8xlarge",
    "r7g.16xlarge" : "r7g.12xlarge",
    "r7g.metal" : "r7g.16xlarge",
    // //U-3tb1
    // "u-3tb1.56xlarge" : "",
    //U-6tb1
    "u-6tb1.56xlarge" : "u-6tb1.56xlarge",
    "u-6tb1.112xlarge" : "u-6tb1.56xlarge",
    "u-6tb1.metal" : "u-6tb1.112xlarge",
    //U-9tb1
    "u-9tb1.112xlarge" : "u-9tb1.112xlarge",
    "u-9tb1.metal" : "u-9tb1.112xlarge",
    //U-12tb1
    "u-12tb1.112xlarge" : "u-12tb1.112xlarge",
    "u-12tb1.metal" : "u-12tb1.112xlarge",
    //U-18tb1
    // "u-18tb1.metal" : "",
    // //U-24tb1
    // "u-24tb1.metal" : "",
    // //X1
    // "x1.16xlarge" : "",
    // "x1.32xlarge" : "",
    // //X2gd
    // "x2gd.medium" : "",
    // "x2gd.large" : "",
    // "x2gd.xlarge" : "",
    // "x2gd.2xlarge" : "",
    // "x2gd.4xlarge" : "",
    // "x2gd.8xlarge" : "",
    // "x2gd.12xlarge" : "",
    // "x2gd.16xlarge" : "",
    // "x2gd.metal" : "",
    // //X2idn
    // "x2idn.16xlarge" : "",
    // "x2idn.24xlarge" : "",
    // "x2idn.32xlarge" : "",
    // "x2idn.metal" : "",
    // //X2iedn
    // "x2iedn.xlarge" : "",
    // "x2iedn.2xlarge" : "",
    // "x2iedn.4xlarge" : "",
    // "x2iedn.8xlarge" : "",
    // "x2iedn.16xlarge" : "",
    // "x2iedn.24xlarge" : "",
    // "x2iedn.32xlarge" : "",
    // "x2iedn.metal" : "",
    // //X2iezn
    // "x2iezn.2xlarge" : "",
    // "x2iezn.4xlarge" : "",
    // "x2iezn.6xlarge" : "",
    // "x2iezn.8xlarge" : "",
    // "x2iezn.12xlarge" : "",
    // "x2iezn.metal" : "",
    // //X1e
    // "x1e.xlarge" : "",
    // "x1e.2xlarge" : "",
    // "x1e.4xlarge" : "",
    // "x1e.8xlarge" : "",
    // "x1e.16xlarge" : "",
    // "x1e.32xlarge" : "",
    //z1d
    "z1d.large" : "z1d.large",
    "z1d.xlarge" : "z1d.large",
    "z1d.2xlarge" : "z1d.xlarge",
    "z1d.3xlarge" : "z1d.2xlarge",
    "z1d.6xlarge" : "z1d.3xlarge",
    "z1d.12xlarge" : "z1d.6xlarge",
    "z1d.metal" : "z1d.12xlarge",
    //D2
    "d2.xlarge" : "d3.xlarge",
    "d2.2xlarge" : "d3.xlarge",
    "d2.4xlarge" : "d3.2xlarge",
    "d2.8xlarge" : "d3.4xlarge",
    //D3
    "d3.xlarge" : "d3.xlarge",
    "d3.2xlarge" : "d3.xlarge",
    "d3.4xlarge" : "d3.2xlarge",
    "d3.8xlarge" : "d3.4xlarge",
    //D3en
    "d3en.xlarge" : "d3en.xlarge",
    "d3en.2xlarge" : "d3en.xlarge",
    "d3en.4xlarge" : "d3en.2xlarge",
    "d3en.6xlarge" : "d3en.4xlarge",
    "d3en.8xlarge" : "d3en.6xlarge",
    "d3en.12xlarge" : "d3en.8xlarge",
    //H1
    "h1.2xlarge" : "h1.2xlarge",
    "h1.4xlarge" : "h1.2xlarge",
    "h1.8xlarge" : "h1.4xlarge",
    "h1.16xlarge" : "h1.8xlarge",
    // //HS1
    // "hs1.8xlarge" : "",
    //I3
    "i3.large" : "i4i.large",
    "i3.xlarge" : "i4i.large",
    "i3.2xlarge" : "i4i.xlarge",
    "i3.4xlarge" : "i4i.2xlarge",
    "i3.8xlarge" : "i4i.4xlarge",
    "i3.16xlarge" : "i4i.8xlarge",
    "i3.metal" : "i4i.32xlarge",
    //I3en
    "i3en.large" : "i4i.large",
    "i3en.xlarge" : "i4i.large",
    "i3en.2xlarge" : "i4i.xlarge",
    "i3en.3xlarge" : "i4i.2xlarge",
    "i3en.6xlarge" : "i4i.4xlarge",
    "i3en.12xlarge" : "i4i.8xlarge",
    "i3en.24xlarge" : "i4i.16xlarge",
    "i3en.metal" : "i4i.32xlarge",
    //I4g
    "i4g.large" : "i4g.large",
    "i4g.xlarge" : "i4g.large",
    "i4g.2xlarge" : "i4g.xlarge",
    "i4g.4xlarge" : "i4g.2xlarge",
    "i4g.8xlarge" : "i4g.4xlarge",
    "i4g.16xlarge" : "i4g.8xlarge",
    //I4i
    "i4i.large" : "i4i.large",
    "i4i.xlarge" : "i4i.large",
    "i4i.2xlarge" : "i4i.xlarge",
    "i4i.4xlarge" : "i4i.2xlarge",
    "i4i.8xlarge" : "i4i.4xlarge",
    "i4i.16xlarge" : "i4i.8xlarge",
    "i4i.32xlarge" : "i4i.16xlarge",
    "i4i.metal" : "i4i.32xlarge",
    //Im4gn
    "im4gn.large" : "im4gn.large",
    "im4gn.xlarge" : "im4gn.large",
    "im4gn.2xlarge" : "im4gn.xlarge",
    "im4gn.4xlarge" : "im4gn.2xlarge",
    "im4gn.8xlarge" : "im4gn.4xlarge",
    "im4gn.16xlarge" : "im4gn.8xlarge",
    //Is4gen
    "is4gen.medium" : "is4gen.medium",
    "is4gen.large" : "is4gen.medium",
    "is4gen.xlarge" : "is4gen.large",
    "is4gen.2xlarge" : "is4gen.xlarge",
    "is4gen.4xlarge" : "is4gen.2xlarge",
    "is4gen.8xlarge" : "is4gen.xlarge",
    // //DL1
    // "dl1.24xlarge" : "",
    //F1
    "f1.2xlarge" : "f1.2xlarge",
    "f1.4xlarge" : "f1.2xlarge",
    "f1.16xlarge" : "f1.4xlarge",
    //G3
    "g3.4xlarge" : "g5.2xlarge",
    "g3.8xlarge" : "g5.4xlarge",
    "g3.16xlarge" : "g5.8xlarge",
    //G4ad
    "g4ad.xlarge" : "g4ad.xlarge",
    "g4ad.2xlarge" : "g4ad.xlarge",
    "g4ad.4xlarge" : "g4ad.2xlarge",
    "g4ad.8xlarge" : "g4ad.4xlarge",
    "g4ad.16xlarge" : "g4ad.8xlarge",
    //G4dn
    "g4dn.xlarge" : "g4dn.xlarge",
    "g4dn.2xlarge" : "g4dn.xlarge",
    "g4dn.4xlarge" : "g4dn.2xlarge",
    "g4dn.8xlarge" : "g4dn.4xlarge",
    "g4dn.12xlarge" : "g4dn.8xlarge",
    "g4dn.16xlarge" : "g4dn.12xlarge",
    "g4dn.metal" : "g4dn.16xlarge",
    //G5
    "g5.xlarge" : "g5.xlarge",
    "g5.2xlarge" : "g5.xlarge",
    "g5.4xlarge" : "g5.2xlarge",
    "g5.8xlarge" : "g5.4xlarge",
    "g5.12xlarge" : "g5.8xlarge",
    "g5.16xlarge" : "g5.12xlarge",
    "g5.24xlarge" : "g5.16xlarge",
    "g5.48xlarge" : "g5.24xlarge",
    //G5g
    "g5g.xlarge" : "g5g.xlarge",
    "g5g.2xlarge" : "g5g.xlarge",
    "g5g.4xlarge" : "g5g.2xlarge",
    "g5g.8xlarge" : "g5g.4xlarge",
    "g5g.16xlarge" : "g5g.8xlarge",
    "g5g.metal" : "g5g.xlarge",
    //Inf1
    "inf1.xlarge" : "inf2.xlarge",
    "inf1.2xlarge" : "inf2.xlarge",
    "inf1.6xlarge" : "inf2.2xlarge",
    "inf1.24xlarge" : "inf2.6xlarge",
    //Inf2
    "inf2.xlarge" : "inf2.xlarge",
    "inf2.8xlarge" : "inf2.xlarge",
    "inf2.24xlarge" : "inf2.8xlarge",
    "inf2.48xlarge" : "inf2.24xlarge",
    //P2
    "p2.xlarge" : "p2.xlarge",
    "p2.8xlarge" : "p3.2xlarge",
    "p2.16xlarge" : "p3.8xlarge",
    //P3
    "p3.2xlarge" : "p3.2xlarge",
    "p3.8xlarge" : "p3.2xlarge",
    "p3.16xlarge" : "p3.8xlarge",
    //P3dn
    // "p3dn.24xlarge" : "",
    // //P4d
    // "p4d.24xlarge" : "",
    // //P4de
    // "p4de.24xlarge" : "",
    // //Trn1
    // "trn1.2xlarge" : "",
    // "trn1.32xlarge" : "",
    // //Trn1n
    // "trn1n.32xlarge" : "",
    //VT1
    "vt1.3xlarge" : "vt1.3xlarge",
    "vt1.6xlarge" : "vt1.3xlarge",
    "vt1.24xlarge" : "vt1.6xlarge",
  }

  // 현재 인스턴스 타입이 매핑 테이블에 있는지 확인하고, 하위 인스턴스 타입을 반환합니다.
  if (instanceTypeMap.hasOwnProperty(currentInstanceType)) {
    return instanceTypeMap[currentInstanceType];
  }
  return currentInstanceType;
}
function proposeNowInstanceType(currentInstanceType) {
  const instanceTypeMap = {
    //M4
    "m4.large" : "m6i.large",
    "m4.xlarge" : "m6i.xlarge",
    "m4.2xlarge" : "m6i.2xlarge",
    "m4.4xlarge" : "m6i.4xlarge",
    "m4.10xlarge" : "m6i.12xlarge",
    "m4.16xlarge" : "m6i.16xlarge",
    //M5
    "m5.large" : "m6i.large",
    "m5.xlarge" : "m6i.xlarge",
    "m5.2xlarge" : "m6i.2xlarge",
    "m5.4xlarge" : "m6i.4xlarge",
    "m5.8xlarge" : "m6i.8xlarge",
    "m5.12xlarge" : "m6i.12xlarge",
    "m5.16xlarge" : "m6i.16xlarge",
    "m5.24xlarge" : "m6i.24xlarge",
    "m5.metal" : "m6i.metal",
    //M5a
    "m5a.large" : "m6a.large",
    "m5a.xlarge" : "m6a.xlarge",
    "m5a.2xlarge" : "m6a.2xlarge",
    "m5a.4xlarge" : "m6a.4xlarge",
    "m5a.8xlarge" : "m6a.8xlarge",
    "m5a.12xlarge" : "m6a.12xlarge",
    "m5a.16xlarge" : "m6a.16xlarge",
    "m5a.24xlarge" : "m6a.24xlarge",
    //M5ad
    "m5ad.large" : "m6a.large",
    "m5ad.xlarge" : "m6a.xlarge",
    "m5ad.2xlarge" : "m6a.2xlarge",
    "m5ad.4xlarge" : "m6a.4xlarge",
    "m5ad.8xlarge" : "m6a.8xlarge",
    "m5ad.12xlarge" : "m6a.12xlarge",
    "m5ad.16xlarge" : "m6a.16xlarge",
    "m5ad.24xlarge" : "m6a.24xlarge",
    //M5d
    "m5d.large" : "m6id.large",
    "m5d.xlarge" : "m6id.xlarge",
    "m5d.2xlarge" : "m6id.2xlarge",
    "m5d.4xlarge" : "m6id.4xlarge",
    "m5d.8xlarge" : "m6id.8xlarge",
    "m5d.12xlarge" : "m6id.12xlarge",
    "m5d.16xlarge" : "m6id.16xlarge",
    "m5d.24xlarge" : "m6id.24xlarge",
    "m5d.metal" : "m6id.metal",
    //M5dn
    "m5dn.large" : "m6idn.large",
    "m5dn.xlarge" : "m6idn.xlarge",
    "m5dn.2xlarge" : "m6idn.2xlarge",
    "m5dn.4xlarge" : "m6idn.4xlarge",
    "m5dn.8xlarge" : "m6idn.8xlarge",
    "m5dn.12xlarge" : "m6idn.12xlarge",
    "m5dn.16xlarge" : "m6idn.16xlarge",
    "m5dn.24xlarge" : "m6idn.24xlarge",
    "m5dn.metal" : "m6idn.metal",
    //M5n
    "m5n.large" : "m6in.large",
    "m5n.xlarge" : "m6in.xlarge",
    "m5n.2xlarge" : "m6in.2xlarge",
    "m5n.4xlarge" : "m6in.4xlarge",
    "m5n.8xlarge" : "m6in.8xlarge",
    "m5n.12xlarge" : "m6in.12xlarge",
    "m5n.16xlarge" : "m6in.16xlarge",
    "m5n.24xlarge" : "m6in.24xlarge",
    "m5n.metal" : "m6in.metal",
    //M5zn
    "m5zn.large" : "m6in.large",
    "m5zn.xlarge" : "m6in.xlarge",
    "m5zn.2xlarge" : "m6in.2xlarge",
    "m5zn.3xlarge" : "m6in.3xlarge",
    "m5zn.6xlarge" : "m6in.6xlarge",
    "m5zn.12xlarge" : "m6in.12xlarge",
    "m5zn.metal" : "m6in.metal",
    //M6a
    "m6a.large" : "m6a.large",
    "m6a.xlarge" : "m6a.xlarge",
    "m6a.2xlarge" : "m6a.2xlarge",
    "m6a.4xlarge" : "m6a.4xlarge",
    "m6a.8xlarge" : "m6a.8xlarge",
    "m6a.12xlarge" : "m6a.12xlarge",
    "m6a.16xlarge" : "m6a.16xlarge",
    "m6a.24xlarge" : "m6a.24xlarge",
    "m6a.32xlarge" : "m6a.32xlarge",
    "m6a.48xlarge" : "m6a.48xlarge",
    "m6a.metal" : "m6a.metal",
    //M6g
    "m6g.medium" : "m7g.medium",
    "m6g.large" : "m7g.large",
    "m6g.xlarge" : "m7g.xlarge",
    "m6g.2xlarge" : "m7g.2xlarge",
    "m6g.4xlarge" : "m7g.4xlarge",
    "m6g.8xlarge" : "m7g.8xlarge",
    "m6g.12xlarge" : "m7g.12xlarge",
    "m6g.16xlarge" : "m7g.16xlarge",
    "m6g.metal" : "m7g.metal", 
    //M6gd
    "m6gd.medium" : "m6gd.medium",
    "m6gd.large" : "m6gd.large",
    
    //M6i
    "m6i.large" : "m6i.large",
    "m6i.xlarge" : "m6i.xlarge",
    "m6i.2xlarge" : "m6i.2xlarge",
    "m6i.4xlarge" : "m6i.4xlarge",
    "m6i.8xlarge" : "m6i.8xlarge",
    "m6i.12xlarge" : "m6i.12xlarge",
    "m6i.16xlarge" : "m6i.16xlarge",
    "m6i.24xlarge" : "m6i.24xlarge",
    "m6i.32xlarge" : "m6i.32xlarge",
    "m6i.metal" : "m6i.metal",
    //M6id
    "m6id.large" : "m6id.large",
    "m6id.xlarge" : "m6id.xlarge",
    "m6id.2xlarge" : "m6id.2xlarge",
    "m6id.4xlarge" : "m6id.4xlarge",
    "m6id.8xlarge" : "m6id.8xlarge",
    "m6id.12xlarge" : "m6id.12xlarge",
    "m6id.16xlarge" : "m6id.16xlarge",
    "m6id.24xlarge" : "m6id.24xlarge",
    "m6id.32xlarge" : "m6id.32xlarge",
    "m6id.metal" : "m6id.metal",    
    //M6idn
    "m6idn.large" : "m6idn.large",
    "m6idn.xlarge" : "m6idn.xlarge",
    "m6idn.2xlarge" : "m6idn.2xlarge",
    "m6idn.4xlarge" : "m6idn.4xlarge",
    "m6idn.8xlarge" : "m6idn.8xlarge",
    "m6idn.12xlarge" : "m6idn.12xlarge",
    "m6idn.16xlarge" : "m6idn.16xlarge",
    "m6idn.24xlarge" : "m6idn.24xlarge",
    "m6idn.32xlarge" : "m6idn.32xlarge",
    "m6idn.metal" : "m6idn.metal",
    //M6in
    "m6in.large" : "m6in.large",
    "m6in.xlarge" : "m6in.xlarge",
    "m6in.2xlarge" : "m6in.2xlarge",
    "m6in.4xlarge" : "m6in.4xlarge",
    "m6in.8xlarge" : "m6in.8xlarge",
    "m6in.12xlarge" : "m6in.12xlarge",
    "m6in.16xlarge" : "m6in.16xlarge",
    "m6in.24xlarge" : "m6in.24xlarge",
    "m6in.32xlarge" : "m6in.32xlarge",
    "m6in.metal" : "m6in.metal",
    //M7g
    "m7g.medium" : "m7g.medium",
    "m7g.large" : "m7g.large",
    "m7g.xlarge" : "m7g.xlarge",
    "m7g.2xlarge" : "m7g.2xlarge",
    "m7g.4xlarge" : "m7g.4xlarge",
    "m7g.8xlarge" : "m7g.8xlarge",
    "m7g.12xlarge" : "m7g.12xlarge",
    "m7g.16xlarge" : "m7g.16xlarge",
    "m7g.metal" : "m7g.metal",
    //Mac1
    // "mac1.metal" : "",
    // //Mac2
    // "mac2.metal" : "",
    //T2
    "t2.nano" : "t3.nano",
    "t2.micro" : "t3.micro",
    "t2.small" : "t3.small",
    "t2.medium" : "t3.medium",
    "t2.large" : "t3.large",
    "t2.xlarge" : "t3.xlarge",
    "t2.2xlarge" : "t3.2xlarge",
    //T3
    "t3.nano" : "t3.nano",
    "t3.micro" : "t3.micro",
    "t3.small" : "t3.small",
    "t3.medium" : "t3.medium",
    "t3.large" : "t3.large",
    "t3.xlarge" : "t3.xlarge",
    "t3.2xlarge" : "t3.2xlarge", 
    //T3a
    "t3a.nano" : "t3a.nano",
    "t3a.micro" : "t3a.micro",
    "t3a.small" : "t3a.small",
    "t3a.medium" : "t3a.medium",
    "t3a.large" : "t3a.large",
    "t3a.xlarge" : "t3a.xlarge",
    "t3a.2xlarge" : "t3a.2xlarge", 
    //T4g
    "t4g.nano" : "t4g.nano",
    "t4g.micro" : "t4g.micro",
    "t4g.small" : "t4g.small",
    "t4g.medium" : "t4g.medium",
    "t4g.large" : "t4g.large",
    "t4g.xlarge" : "t4g.xlarge",
    "t4g.2xlarge" : "t4g.2xlarge", 
    //C4
    "c4.large" : "c6i.large",
    "c4.xlarge" : "c6i.xlarge",
    "c4.2xlarge" : "c6i.2xlarge",
    "c4.4xlarge" : "c6i.4xlarge",
    "c4.8xlarge" : "c6i.8xlarge",
    //C5
    "c5.large" : "c6i.large",
    "c5.xlarge" : "c6i.xlarge",
    "c5.2xlarge" : "c6i.2xlarge",
    "c5.4xlarge" : "c6i.4xlarge",
    "c5.9xlarge" : "c5.9xlarge",
    "c5.12xlarge" : "c6i.12xlarge",
    "c5.18xlarge" : "c5.18xlarge",
    "c5.24xlarge" : "c6i.24xlarge",
    "c5.metal" : "c6i.metal", 
    //C5a
    "c5a.large" : "c6a.large",
    "c5a.xlarge" : "c6a.xlarge",
    "c5a.2xlarge" : "c6a.2xlarge",
    "c5a.4xlarge" : "c6a.4xlarge",
    "c5a.8xlarge" : "c6a.8xlarge",
    "c5a.12xlarge" : "c6a.12xlarge",
    "c5a.16xlarge" : "c6a.16xlarge",
    "c5a.24xlarge" : "c6a.24xlarge", 
    //C5ad
    "c5ad.large" : "c5ad.large",
    "c5ad.xlarge" : "c5ad.xlarge",
    "c5ad.2xlarge" : "c5ad.2xlarge",
    "c5ad.4xlarge" : "c5ad.4xlarge",
    "c5ad.8xlarge" : "c5ad.8xlarge",
    "c5ad.12xlarge" : "c5ad.12xlarge",
    "c5ad.16xlarge" : "c5ad.16xlarge",
    "c5ad.24xlarge" : "c5ad.24xlarge", 
    //C5d
    "c5d.large" : "c6id.large",
    "c5d.xlarge" : "c6id.xlarge",
    "c5d.2xlarge" : "c6id.2xlarge",
    "c5d.4xlarge" : "c6id.4xlarge",
    "c5.9xlarge" : "c5.9xlarge",
    "c5d.12xlarge" : "c6id.12xlarge",
    "c5d.18xlarge" : "c5d.18xlarge",
    "c5d.24xlarge" : "c6id.24xlarge",
    "c5d.metal" : "c6id.metal", 
    //C5n
    "c5n.large" : "c6in.large",
    "c5n.xlarge" : "c6in.xlarge",
    "c5n.2xlarge" : "c6in.2xlarge",
    "c5n.4xlarge" : "c6in.4xlarge",
    "c5n.9xlarge" : "c5n.9xlarge",
    "c5n.18xlarge" : "c5n.18xlarge",
    "c5n.metal" : "c6in.metal", 
    //C6a
    "c6a.large" : "c6a.large",
    "c6a.xlarge" : "c6a.xlarge",
    "c6a.2xlarge" : "c6a.2xlarge",
    "c6a.4xlarge" : "c6a.4xlarge",
    "c6a.8xlarge" : "c6a.8xlarge",
    "c6a.12xlarge" : "c6a.12xlarge",
    "c6a.16xlarge" : "c6a.16xlarge",
    "c6a.24xlarge" : "c6a.24xlarge",
    "c6a.32xlarge" : "c6a.32xlarge",
    "c6a.48xlarge" : "c6a.48xlarge",
    "c6a.metal" : "c6a.metal",
    //C6g
    "c6g.medium" : "c6g.medium",
    "c6g.large" : "c6g.large",
    "c6g.xlarge" : "c6g.xlarge",
    "c6g.2xlarge" : "c6g.2xlarge",
    "c6g.4xlarge" : "c6g.4xlarge",
    "c6g.8xlarge" : "c6g.8xlarge",
    "c6g.12xlarge" : "c6g.12xlarge",
    "c6g.16xlarge" : "c6g.16xlarge",
    "c6g.metal" : "c6g.metal",
    //C6gd
    "c6gd.medium" : "c6gd.medium",
    "c6gd.large" : "c6gd.large",
    "c6gd.xlarge" : "c6gd.xlarge",
    "c6gd.2xlarge" : "c6gd.2xlarge",
    "c6gd.4xlarge" : "c6gd.4xlarge",
    "c6gd.8xlarge" : "c6gd.8xlarge",
    "c6gd.12xlarge" : "c6gd.12xlarge",
    "c6gd.16xlarge" : "c6gd.16xlarge",
    "c6gd.metal" : "c6gd.metal",    
    //C6gn
    "c6gn.medium" : "c6gn.medium",
    "c6gn.large" : "c6gn.large",
    "c6gn.xlarge" : "c6gn.xlarge",
    "c6gn.2xlarge" : "c6gn.2xlarge",
    "c6gn.4xlarge" : "c6gn.4xlarge",
    "c6gn.8xlarge" : "c6gn.8xlarge",
    "c6gn.12xlarge" : "c6gn.12xlarge",
    "c6gn.16xlarge" : "c6gn.16xlarge", 
    //C6i
    "c6i.large" : "c6i.large",
    "c6i.xlarge" : "c6i.xlarge",
    "c6i.2xlarge" : "c6i.2xlarge",
    "c6i.4xlarge" : "c6i.4xlarge",
    "c6i.8xlarge" : "c6i.8xlarge",
    "c6i.12xlarge" : "c6i.12xlarge",
    "c6i.16xlarge" : "c6i.16xlarge",
    "c6i.24xlarge" : "c6i.24xlarge",
    "c6i.32xlarge" : "c6i.32xlarge",
    "c6i.metal" : "c6i.metal", 
    //C6id
    "c6id.large" : "c6id.large",
    "c6id.xlarge" : "c6id.xlarge",
    "c6id.2xlarge" : "c6id.2xlarge",
    "c6id.4xlarge" : "c6id.4xlarge",
    "c6id.8xlarge" : "c6id.8xlarge",
    "c6id.12xlarge" : "c6id.12xlarge",
    "c6id.16xlarge" : "c6id.16xlarge",
    "c6id.24xlarge" : "c6id.24xlarge",
    "c6id.32xlarge" : "c6id.32xlarge",
    "c6id.metal" : "c6id.metal", 
    //C6in
    "c6in.large" : "c6in.large",
    "c6in.xlarge" : "c6in.xlarge",
    "c6in.2xlarge" : "c6in.2xlarge",
    "c6in.4xlarge" : "c6in.4xlarge",
    "c6in.8xlarge" : "c6in.8xlarge",
    "c6in.12xlarge" : "c6in.12xlarge",
    "c6in.16xlarge" : "c6in.16xlarge",
    "c6in.24xlarge" : "c6in.24xlarge",
    "c6in.32xlarge" : "c6in.32xlarge",
    "c6in.metal" : "c6in.metal", 
    //C7g
    "c7g.medium" : "c7g.medium",
    "c7g.large" : "c7g.large",
    "c7g.xlarge" : "c7g.xlarge",
    "c7g.2xlarge" : "c7g.2xlarge",
    "c7g.4xlarge" : "c7g.4xlarge",
    "c7g.8xlarge" : "c7g.8xlarge",
    "c7g.12xlarge" : "c7g.12xlarge",
    "c7g.16xlarge" : "c7g.16xlarge",
    "c7g.metal" : "c7g.metal",     
    // //CC2
    // "cc2.8xlarge" : "",
    // //Hpc6a
    // "hpc6a.48xlarge" : "",
    // //CR1
    // "cr1.8xlarge" : "",
    // //Hpc6id
    // "hpc6id.32xlarge" : "",
    //R4
    "r4.large" : "r6i.large",
    "r4.xlarge" : "r6i.xlarge",
    "r4.2xlarge" : "r6i.2xlarge",
    "r4.4xlarge" : "r6i.4xlarge",
    "r4.8xlarge" : "r6i.8xlarge",
    "r4.16xlarge" : "r6i.16xlarge",
    //R5
    "r5.large" : "r6i.large",
    "r5.xlarge" : "r6i.xlarge",
    "r5.2xlarge" : "r6i.2xlarge",
    "r5.4xlarge" : "r6i.4xlarge",
    "r5.8xlarge" : "r6i.8xlarge",
    "r5.12xlarge" : "r6i.12xlarge",
    "r5.16xlarge" : "r6i.16xlarge",
    "r5.24xlarge" : "r6i.24xlarge",
    "r5.metal" : "r6i.metal",
    //R5a
    "r5a.large" : "r6a.large",
    "r5a.xlarge" : "r6a.xlarge",
    "r5a.2xlarge" : "r6a.2xlarge",
    "r5a.4xlarge" : "r6a.4xlarge",
    "r5a.8xlarge" : "r6a.8xlarge",
    "r5a.12xlarge" : "r6a.12xlarge",
    "r5a.16xlarge" : "r6a.16xlarge",
    "r5a.24xlarge" : "r6a.24xlarge",
    //R5ad
    "r5ad.large" : "r5ad.large",
    "r5ad.xlarge" : "r5ad.xlarge",
    "r5ad.2xlarge" : "r5ad.2xlarge",
    "r5ad.4xlarge" : "r5ad.4xlarge",
    "r5ad.8xlarge" : "r5ad.8xlarge",
    "r5ad.12xlarge" : "r5ad.12xlarge",
    "r5ad.16xlarge" : "r5ad.16xlarge",
    "r5ad.24xlarge" : "r5ad.24xlarge", 
    //R5b
    "r5b.large" : "r6i.large",
    "r5b.xlarge" : "r6i.xlarge",
    "r5b.2xlarge" : "r6i.2xlarge",
    "r5b.4xlarge" : "r6i.4xlarge",
    "r5b.8xlarge" : "r6i.8xlarge",
    "r5b.12xlarge" : "r6i.12xlarge",
    "r5b.16xlarge" : "r6i.16xlarge",
    "r5b.24xlarge" : "r6i.24xlarge",
    "r5b.metal" : "r6i.metal", 
    //R5d
    "r5d.large" : "r6id.large",
    "r5d.xlarge" : ".xlarge",
    "r5d.2xlarge" : ".2xlarge",
    "r5d.4xlarge" : ".4xlarge",
    "r5d.8xlarge" : ".8xlarge",
    "r5d.12xlarge" : ".12xlarge",
    "r5d.16xlarge" : ".16xlarge",
    "r5d.24xlarge" : ".24xlarge",
    "r5d.metal" : ".metal", 
    //R5dn
    "r5dn.large" : "r6idn.large",
    "r5dn.xlarge" : "r6idn.xlarge",
    "r5dn.2xlarge" : "r6idn.2xlarge",
    "r5dn.4xlarge" : "r6idn.4xlarge",
    "r5dn.8xlarge" : "r6idn.8xlarge",
    "r5dn.12xlarge" : "r6idn.12xlarge",
    "r5dn.16xlarge" : "r6idn.16xlarge",
    "r5dn.24xlarge" : "r6idn.24xlarge",
    "r5dn.metal" : "r6idn.metal", 
    //R5n
    "r5n.large" : "r6in.large",
    "r5n.xlarge" : "r6in.xlarge",
    "r5n.2xlarge" : "r6in.2xlarge",
    "r5n.4xlarge" : "r6in.4xlarge",
    "r5n.8xlarge" : "r6in.8xlarge",
    "r5n.12xlarge" : "r6in.12xlarge",
    "r5n.16xlarge" : "r6in.16xlarge",
    "r5n.24xlarge" : "r6in.24xlarge",
    "r5n.metal" : "r6in.metal", 
    //R6a
    "r6a.large" : "r6a.large",
    "r6a.xlarge" : "r6a.xlarge",
    "r6a.2xlarge" : "r6a.2xlarge",
    "r6a.4xlarge" : "r6a.4xlarge",
    "r6a.8xlarge" : "r6a.8xlarge",
    "r6a.12xlarge" : "r6a.12xlarge",
    "r6a.16xlarge" : "r6a.16xlarge",
    "r6a.24xlarge" : "r6a.24xlarge",
    "r6a.32xlarge" : "r6a.32xlarge",
    "r6a.48xlarge" : "r6a.48xlarge",
    "r6a.metal" : "r6a.metal", 
    //R6g
    "r6g.medium" : "r6g.medium",
    "r6g.large" : "r6g.large",
    "r6g.xlarge" : "r6g.xlarge",
    "r6g.2xlarge" : "r6g.2xlarge",
    "r6g.4xlarge" : "r6g.4xlarge",
    "r6g.8xlarge" : "r6g.8xlarge",
    "r6g.12xlarge" : "r6g.12xlarge",
    "r6g.16xlarge" : "r6g.16xlarge",
    "r6g.metal" : "r6g.metal", 
    //R6gd
    "r6gd.medium" : "r6gd.medium",
    "r6gd.large" : "r6gd.large",
    "r6gd.xlarge" : "r6gd.xlarge",
    "r6gd.2xlarge" : "r6gd.2xlarge",
    "r6gd.4xlarge" : "r6gd.4xlarge",
    "r6gd.8xlarge" : "r6gd.8xlarge",
    "r6gd.12xlarge" : "r6gd.12xlarge",
    "r6gd.16xlarge" : "r6gd.16xlarge",
    "r6gd.metal" : "r6gd.metal",
    //R6i
    "r6i.large" : "r6i.large",
    "r6i.xlarge" : "r6i.xlarge",
    "r6i.2xlarge" : "r6i.2xlarge",
    "r6i.4xlarge" : "r6i.4xlarge",
    "r6i.8xlarge" : "r6i.8xlarge",
    "r6i.12xlarge" : "r6i.12xlarge",
    "r6i.16xlarge" : "r6i.16xlarge",
    "r6i.24xlarge" : "r6i.24xlarge",
    "r6i.32xlarge" : "r6i.32xlarge",
    "r6i.metal" : "r6i.metal",
    //R6idn
    "r6idn.large" : "r6idn.large",
    "r6idn.xlarge" : "r6idn.xlarge",
    "r6idn.2xlarge" : "r6idn.2xlarge",
    "r6idn.4xlarge" : "r6idn.4xlarge",
    "r6idn.8xlarge" : "r6idn.8xlarge",
    "r6idn.12xlarge" : "r6idn.12xlarge",
    "r6idn.16xlarge" : "r6idn.16xlarge",
    "r6idn.24xlarge" : "r6idn.24xlarge",
    "r6idn.32xlarge" : "r6idn.32xlarge",
    "r6idn.metal" : "r6idn.metal",
    //R6in
    "r6in.large" : "r6in.large",
    "r6in.xlarge" : "r6in.xlarge",
    "r6in.2xlarge" : "r6in.2xlarge",
    "r6in.4xlarge" : "r6in.4xlarge",
    "r6in.8xlarge" : "r6in.8xlarge",
    "r6in.12xlarge" : "r6in.12xlarge",
    "r6in.16xlarge" : "r6in.16xlarge",
    "r6in.24xlarge" : "r6in.24xlarge",
    "r6in.32xlarge" : "r6in.32xlarge",
    "r6in.metal" : "r6in.metal",
    //R6id
    "r6id.large" : "r6id.large",
    "r6id.xlarge" : "r6id.xlarge",
    "r6id.2xlarge" : "r6id.2xlarge",
    "r6id.4xlarge" : "r6id.4xlarge",
    "r6id.8xlarge" : "r6id.8xlarge",
    "r6id.12xlarge" : "r6id.12xlarge",
    "r6id.16xlarge" : "r6id.16xlarge",
    "r6id.24xlarge" : "r6id.24xlarge",
    "r6id.32xlarge" : "r6id.32xlarge",
    "r6id.metal" : "r6id.metal", 
    //R7g
    "r7g.medium" : "r7g.medium",
    "r7g.large" : "r7g.large",
    "r7g.xlarge" : "r7g.xlarge",
    "r7g.2xlarge" : "r7g.2xlarge",
    "r7g.4xlarge" : "r7g.4xlarge",
    "r7g.8xlarge" : "r7g.8xlarge",
    "r7g.12xlarge" : "r7g.12xlarge",
    "r7g.16xlarge" : "r7g.16xlarge",
    "r7g.metal" : "r7g.metal", 
    // //U-3tb1
    // "u-3tb1.56xlarge" : "",
    //U-6tb1
    "u-6tb1.56xlarge" : "u-6tb1.56xlarge",
    "u-6tb1.112xlarge" : "u-6tb1.112xlarge",
    "u-6tb1.metal" : "u-6tb1.metal",
    //U-9tb1
    "u-9tb1.112xlarge" : "u-9tb1.112xlarge",
    "u-9tb1.metal" : "u-9tb1.metal",
    //U-12tb1
    "u-12tb1.112xlarge" : "u-12tb1.112xlarge",
    "u-12tb1.metal" : "u-12tb1.metal",
    //U-18tb1
    // "u-18tb1.metal" : "",
    // //U-24tb1
    // "u-24tb1.metal" : "",
    // //X1
    // "x1.16xlarge" : "",
    // "x1.32xlarge" : "",
    // //X2gd
    // "x2gd.medium" : "",
    // "x2gd.large" : "",
    // "x2gd.xlarge" : "",
    // "x2gd.2xlarge" : "",
    // "x2gd.4xlarge" : "",
    // "x2gd.8xlarge" : "",
    // "x2gd.12xlarge" : "",
    // "x2gd.16xlarge" : "",
    // "x2gd.metal" : "",
    // //X2idn
    // "x2idn.16xlarge" : "",
    // "x2idn.24xlarge" : "",
    // "x2idn.32xlarge" : "",
    // "x2idn.metal" : "",
    // //X2iedn
    // "x2iedn.xlarge" : "",
    // "x2iedn.2xlarge" : "",
    // "x2iedn.4xlarge" : "",
    // "x2iedn.8xlarge" : "",
    // "x2iedn.16xlarge" : "",
    // "x2iedn.24xlarge" : "",
    // "x2iedn.32xlarge" : "",
    // "x2iedn.metal" : "",
    // //X2iezn
    // "x2iezn.2xlarge" : "",
    // "x2iezn.4xlarge" : "",
    // "x2iezn.6xlarge" : "",
    // "x2iezn.8xlarge" : "",
    // "x2iezn.12xlarge" : "",
    // "x2iezn.metal" : "",
    // //X1e
    // "x1e.xlarge" : "",
    // "x1e.2xlarge" : "",
    // "x1e.4xlarge" : "",
    // "x1e.8xlarge" : "",
    // "x1e.16xlarge" : "",
    // "x1e.32xlarge" : "",
    //z1d
    "z1d.large" : "z1d.large",
    "z1d.xlarge" : "z1d.xlarge",
    "z1d.2xlarge" : "z1d.2xlarge",
    "z1d.3xlarge" : "z1d.3xlarge",
    "z1d.6xlarge" : "z1d.6xlarge",
    "z1d.12xlarge" : "z1d.12xlarge",
    "z1d.metal" : "z1d.metal", 
    //D2
    "d2.xlarge" : "d3.xlarge",
    "d2.2xlarge" : "d3.2xlarge",
    "d2.4xlarge" : "d3.4xlarge",
    "d2.8xlarge" : "d3.8xlarge", 
    //D3
    "d3.xlarge" : "d3.xlarge",
    "d3.2xlarge" : "d3.2xlarge",
    "d3.4xlarge" : "d3.4xlarge",
    "d3.8xlarge" : "d3.8xlarge", 
    //D3en
    "d3en.xlarge" : "d3en.xlarge",
    "d3en.2xlarge" : "d3en.2xlarge",
    "d3en.4xlarge" : "d3en.4xlarge",
    "d3en.6xlarge" : "d3en.6xlarge",
    "d3en.8xlarge" : "d3en.8xlarge",
    "d3en.12xlarge" : "d3en.12xlarge", 
    //H1
    "h1.2xlarge" : "h1.2xlarge",
    "h1.4xlarge" : "h1.4xlarge",
    "h1.8xlarge" : "h1.8xlarge",
    "h1.16xlarge" : "h1.16xlarge",
    //HS1
    // "hs1.8xlarge" : "",
    //I3
    "i3.large" : "i4i.large",
    "i3.xlarge" : "i4i.xlarge",
    "i3.2xlarge" : "i4i.2xlarge",
    "i3.4xlarge" : "i4i.4xlarge",
    "i3.8xlarge" : "i4i.8xlarge",
    "i3.16xlarge" : "i4i.16xlarge",
    "i3.metal" : "i4i.metal", 
    //I3en
    "i3en.large" : "i4i.large",
    "i3en.xlarge" : "i3en.xlarge",
    "i3en.2xlarge" : "i4i.2xlarge",
    "i3en.3xlarge" : "i3en.3xlarge",
    "i3en.6xlarge" : "i3en.6xlarge",
    "i3en.12xlarge" : "i3en.12xlarge",
    "i3en.24xlarge" : "i3en.24xlarge",
    "i3en.metal" : "i4i.metal", 
    //I4g
    "i4g.large" : "i4g.large",
    "i4g.xlarge" : "i4g.xlarge",
    "i4g.2xlarge" : "i4g.2xlarge",
    "i4g.4xlarge" : "i4g.4xlarge",
    "i4g.8xlarge" : "i4g.8xlarge",
    "i4g.16xlarge" : "i4g.16xlarge",     
    //I4i
    "i4i.large" : "i4i.large",
    "i4i.xlarge" : "i4i.xlarge",
    "i4i.2xlarge" : "i4i.2xlarge",
    "i4i.4xlarge" : "i4i.4xlarge",
    "i4i.8xlarge" : "i4i.8xlarge",
    "i4i.16xlarge" : "i4i.16xlarge",
    "i4i.32xlarge" : "i4i.32xlarge",
    "i4i.metal" : "i4i.metal", 
    //Im4gn
    "im4gn.large" : "im4gn.large",
    "im4gn.xlarge" : "im4gn.xlarge",
    "im4gn.2xlarge" : "im4gn.2xlarge",
    "im4gn.4xlarge" : "im4gn.4xlarge",
    "im4gn.8xlarge" : "im4gn.8xlarge",
    "im4gn.16xlarge" : "im4gn.16xlarge", 
    //Is4gen
    "is4gen.medium" : "is4gen.medium",
    "is4gen.large" : "is4gen.large",
    "is4gen.xlarge" : "is4gen.xlarge",
    "is4gen.2xlarge" : "is4gen.2xlarge",
    "is4gen.4xlarge" : "is4gen.4xlarge",
    "is4gen.8xlarge" : "is4gen.8xlarge",
    // //DL1
    // "dl1.24xlarge" : "",
    //F1
    "f1.2xlarge" : "f1.2xlarge",
    "f1.4xlarge" : "f1.4xlarge",
    "f1.16xlarge" : "f1.16xlarge",
    //G3
    "g3.4xlarge" : "g5.4xlarge",
    "g3.8xlarge" : "g5.8xlarge",
    "g3.16xlarge" : "g5.16xlarge", 
    //G4ad
    "g4ad.xlarge" : "g4ad.xlarge",
    "g4ad.2xlarge" : "g4ad.2xlarge",
    "g4ad.4xlarge" : "g4ad.4xlarge",
    "g4ad.8xlarge" : "g4ad.8xlarge",
    "g4ad.16xlarge" : "g4ad.16xlarge", 
    //G4dn
    "g4dn.xlarge" : "g4dn.xlarge",
    "g4dn.2xlarge" : "g4dn.2xlarge",
    "g4dn.4xlarge" : "g4dn.4xlarge",
    "g4dn.8xlarge" : "g4dn.8xlarge",
    "g4dn.12xlarge" : "g4dn.12xlarge",
    "g4dn.16xlarge" : "g4dn.16xlarge",
    "g4dn.metal" : "g4dn.metal", 
    //G5
    "g5.xlarge" : "g5.xlarge",
    "g5.2xlarge" : "g5.2xlarge",
    "g5.4xlarge" : "g5.4xlarge",
    "g5.8xlarge" : "g5.8xlarge",
    "g5.12xlarge" : "g5.12xlarge",
    "g5.16xlarge" : "g5.16xlarge",
    "g5.24xlarge" : "g5.24xlarge",
    "g5.48xlarge" : "g5.48xlarge", 
    //G5g
    "g5g.xlarge" : "g5g.xlarge",
    "g5g.2xlarge" : "g5g.2xlarge",
    "g5g.4xlarge" : "g5g.4xlarge",
    "g5g.8xlarge" : "g5g.8xlarge",
    "g5g.16xlarge" : "g5g.16xlarge",
    "g5g.metal" : "g5g.metal", 
    //Inf1
    "inf1.xlarge" : "inf2.xlarge",
    "inf1.2xlarge" : "inf2.2xlarge",
    "inf1.6xlarge" : "inf2.8xlarge",
    "inf1.24xlarge" : "inf2.24xlarge",
    //Inf2
    "inf2.xlarge" : "inf2.xlarge",
    "inf2.8xlarge" : "inf2.8xlarge",
    "inf2.24xlarge" : "nf2.24xlarge",
    "inf2.48xlarge" : "inf2.48xlarge",
    //P2
    "p2.xlarge" : "p2.xlarge",
    "p2.8xlarge" : "p3.8xlarge",
    "p2.16xlarge" : "p3.16xlarge",
    //P3
    "p3.2xlarge" : "p3.2xlarge",
    "p3.8xlarge" : "p3.8xlarge",
    "p3.16xlarge" : "p3.16xlarge",
    //P3dn
    // "p3dn.24xlarge" : "",
    // //P4d
    // "p4d.24xlarge" : "",
    // //P4de
    // "p4de.24xlarge" : "",
    // //Trn1
    // "trn1.2xlarge" : "",
    // "trn1.32xlarge" : "",
    // //Trn1n
    // "trn1n.32xlarge" : "",
    //VT1
    "vt1.3xlarge" : "vt1.3xlarge",
    "vt1.6xlarge" : "vt1.6xlarge",
    "vt1.24xlarge" : "vt1.24xlarge",
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
