var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('ec2.html');
});

router.get('/ec2', function(req, res, next) {
  res.render('ec2.html');
});

router.get('/rds', function(req, res, next) {
  res.render('rds.html');
});

router.get('/cf', function(req, res, next) {
  try{
    const AWS = require('aws-sdk');
    AWS.config.update({ region: 'ap-northeast-2' });  

    // CloudFront 클라이언트 생성
    const cloudfront = new AWS.CloudFront();

    // CloudFront 배포 ID 설정
    const distributionId = '';

    // 배포 ID의 오브젝트 리스트 가져오기
    cloudfront.listObjects({ DistributionId: distributionId }, (err, data) => {
      if (err) {
        console.error('Error retrieving object list:', err);
      } else {
        const objects = data.Objects.Items;
        if (objects.length > 0) {
          console.log('Object List:');
          objects.forEach((object) => {
            console.log(' -', object.Key);
    
            // 각 객체의 사용량 가져오기
            cloudfront.getCloudFrontOriginAccessIdentityConfig({ Id: object.Id }, (err, data) => {
              if (err) {
                console.error('Error retrieving object usage:', err);
              } else {
                console.log('   Usage:', data.CloudFrontOriginAccessIdentityConfig.UsageProfile);
              }
            });
          });
        } else {
          console.log('No objects found for the specified distribution ID.');
        }
      }
    });
  }catch (err) {
    console.log(err);
  }
  
  res.send(200);
});

// router.get('/ec2/:id', async function(req, res, next) {
//   const AWS = require('aws-sdk');
//   AWS.config.update({ region: 'ap-northeast-2' }); 
//   AWS.config.credentials = new AWS.TemporaryCredentials({
//     RoleArn: `arn:aws:iam::${req.params.id}:role/Smileshark-sysadmin`, // Replace with your ARN role
//   });
//   const ec2 = new AWS.EC2();
//   ec2.describeInstances({}, (err, data) => {
//     if (err) {
//       console.error('Error retrieving EC2 instances:', err);
//       res.status(500).json({ error: 'Error retrieving EC2 instances' });
//     } else {
//       const instances = data.Reservations.reduce((acc, reservation) => {
//         acc.push(...reservation.Instances);
//         return acc;
//       }, []);

//       const result = [];

//       for (instance of instances) {
//         const instanceId = instance.InstanceId;
//         const instanceName = instance.Tags[0].Value;
//         const instanceType = instance.InstanceType;

//         const instanceData = {
//           instanceName: instanceName,
//           instanceId: instanceId,
//           instanceType: instanceType,
//           proposedInstanceType: null
//         };

//         const cloudwatch = new AWS.CloudWatch();            
//         // Calculate the start and end times for the 2-week period
//         const endTime = new Date();
//         const startTime = new Date(endTime.getTime() - (14 * 24 * 60 * 60 * 1000));
//         const params = {
//           EndTime: endTime,
//           MetricName: 'CPUUtilization',
//           Namespace: 'AWS/EC2',
//           Period: 86400, // 24 hours in seconds
//           StartTime: startTime,
//           Statistics: ['Maximum'],
//           Dimensions: [
//             {
//               Name: 'InstanceId',
//               Value: instanceId
//             },
//           ],
//           Unit: 'Percent'
//         };

//         cloudwatch.getMetricStatistics(params, (err, data) => {
//           if (err) {
//             console.error('Error retrieving CloudWatch metrics:', err);
//             res.status(500).json({ error: 'Error retrieving CloudWatch metrics' });
//           } else {
//             const maxCpuUsage = data.Datapoints.reduce((max, datapoint) => {
//               return datapoint.Maximum > max ? datapoint.Maximum : max;
//             }, 0);
            
//             if (maxCpuUsage != 0) {
//               instanceData.maxCpuUsage = maxCpuUsage.toFixed(2) + " %";

//               if (maxCpuUsage >= 80) {
//                 instanceData.proposedInstanceType = "▲ " + proposeHigherInstanceType(instanceType) ;
//               } else if (maxCpuUsage <= 40) {
//                 instanceData.proposedInstanceType = "▼ " + proposeLowerInstanceType(instanceType);
//               } else{
//                 instanceData.proposedInstanceType = "≡ " + proposeNowInstanceType(instanceType);
//               }
//             }else{
//               instanceData.maxCpuUsage = "0 %";
//             }
            
//             result.push(instanceData);
            
//             if (result.length === instances.length) {
//               res.json(result);
//             }
//           }
//         });
//       }
//     }
//   });
// });
// function proposeHigherInstanceType(currentInstanceType) {
//   //상위 인스턴스 정의. 세대업그레이드 포함
//   const instanceTypeMap = {
//     // 범용t, 세대업글부터
//     't2.micro': 't3.small',
//     't2.small': 't3.medium',
//     't2.medium': 't3.large',
//     't2.large': 't3.xlarge',
//     't2.xlarge': 't3.2xlarge',
//     't2.2xlarge': 't3.2xlarge',
//     // 범용t
//     't3.micro': 't3.small',
//     't3.small': 't3.medium',
//     't3.medium': 't3.large',
//     't3.large': 't3.xlarge',
//     't3.xlarge': 't3.2xlarge',
//     't3.2xlarge': 't3.2xlarge',
//     // 범용 m4, 세대업글부터
//     'm4.large': 'm6i.xlarge',
//     'm4.xlarge': 'm6i.2xlarge',
//     'm4.2xlarge': 'm6i.4xlarge',
//     'm4.4xlarge': 'm6i.8xlarge',
//     'm4.10xlarge': 'm6i.12xlarge',
//     'm4.16xlarge': 'm6i.16xlarge',
//     // 범용 m5, 세대업글부터
//     'm5.large': 'm6i.xlarge',
//     'm5.xlarge': 'm6i.2xlarge',
//     'm5.2xlarge': 'm6i.4xlarge',
//     'm5.4xlarge': 'm6i.8xlarge',
//     'm5.8xlarge': 'm6i.12xlarge',
//     'm5.12xlarge': 'm6i.16xlarge',
//     'm5.16xlarge': 'm6i.24xlarge',
//     'm5.24xlarge': 'm6i.32xlarge',
//     // 범용 m6i
//     'm6i.large': 'm6i.xlarge',
//     'm6i.xlarge': 'm6i.2xlarge',
//     'm6i.2xlarge': 'm6i.4xlarge',
//     'm6i.4xlarge': 'm6i.8xlarge',
//     'm6i.8xlarge': 'm6i.12xlarge	',
//     'm6i.12xlarge	': 'm6i.16xlarge',
//     'm6i.16xlarge	': 'm6i.24xlarge',
//     'm6i.24xlarge': 'm6i.32xlarge',
//     'm6i.32xlarge': 'm6i.metal',
//     // 컴퓨팅 c4, 세대 업글부터
//     'c4.large': 'c5.xlarge',
//     'c4.xlarge': 'c5.2xlarge',
//     'c4.2xlarge': 'c5.4xlarge',
//     'c4.4xlarge': 'c5.9xlarge',
//     'c4.8xlarge': 'c5.12xlarge',
//     // 컴퓨팅 c5, 세대 업글부터
//     'c5.large': 'c6i.xlarge',
//     'c5.xlarge': 'c6i.2xlarge',
//     'c5.2xlarge': 'c6i.4xlarge',
//     'c5.4xlarge': 'c6i.8xlarge',
//     'c5.9xlarge': 'c6i.12xlarge',
//     'c5.12xlarge': 'c6i.16xlarge',
//     'c5.18xlarge': 'c6i.24xlarge',
//     'c5.24xlarge': 'c6i.32xlarge',
//     // 컴퓨팅 c6
//     'c6i.large': 'c6i.xlarge',
//     'c6i.xlarge': 'c6i.2xlarge',
//     'c6i.2xlarge': 'c6i.4xlarge',
//     'c6i.4xlarge': 'c6i.8xlarge',
//     'c6i.8xlarge': 'c6i.12xlarge',
//     'c6i.12xlarge': 'c6i.16xlarge',
//     'c6i.16xlarge': 'c6i.24xlarge',
//     'c6i.24xlarge': 'c6i.32xlarge',
//     'c6i.32xlarge': 'c6i.metal',
//     // 메모리 r, 세대업글부터
//     'r4.large': 'r6i.xlarge',
//     'r4.xlarge': 'r6i.2xlarge',
//     'r4.2xlarge': 'r6i.4xlarge',
//     'r4.4xlarge': 'r6i.8xlarge',
//     'r4.8xlarge': 'r6i.12xlarge',
//     'r4.16xlarge': 'r6i.24xlarge',
//     // 메모리 r5
//     'r5.large': 'r6i.xlarge',
//     'r5.xlarge': 'r6i.2xlarge',
//     'r5.2xlarge': 'r6i.4xlarge',
//     'r5.4xlarge': 'r6i.8xlarge',
//     'r5.8xlarge': 'r6i.12xlarge',
//     'r5.12xlarge': 'r6i.16xlarge',
//     'r5.16xlarge': 'r6i.24xlarge',
//     'r5.24xlarge': 'r6i.metal',
//     // 메모리 r6
//     'r6i.large': 'r6i.xlarge',
//     'r6i.xlarge': 'r6i.2xlarge',
//     'r6i.2xlarge': 'r6i.4xlarge',
//     'r6i.4xlarge': 'r6i.8xlarge',
//     'r6i.8xlarge': 'r6i.12xlarge',
//     'r6i.12xlarge': 'r6i.16xlarge',
//     'r6i.16xlarge	': 'r6i.24xlarge',
//     'r6i.24xlarge': 'r6i.32xlarge',
//     'r6i.32xlarge': 'r6i.metal',
//     // 가속화 컴퓨팅 p, 세대업글부터
//     'p3.2xlarge': 'p4d.24xlarge',
//     'p3.8xlarge': 'p4d.24xlarge',
//     'p3.16xlarge': 'p4d.24xlarge',
//     'p3dn.24xlarge': 'p4d.24xlarge',
//     // 가속화 컴푸팅 p
//     'p4d.24xlarge': 'p4de.24xlarge',
//     // 스토리지 최적화 i3en, 세대업글부터
//     'i3en.large': 'i4i.xlarge',
//     'i3en.xlarge': 'i4i.2xlarge',
//     'i3en.2xlarge': 'i4i.4xlarge',
//     'i3en.3xlarge': 'i4i.8xlarge',
//     'i3en.6xlarge': 'i4i.8xlarge',
//     'i3en.12xlarge': 'i4i.16xlarge',
//     'i3en.24xlarge': 'i4i.32xlarge',
//     'i3en.metal': 'i4i.metal',
//     // 스토리지 최적화 i3, 세대 업글부터
//     'i3.large': 'i4i.xlarge',
//     'i3.xlarge': 'i4i.2xlarge',
//     'i3.2xlarge': 'i4i.4xlarge',
//     'i3.4xlarge': 'i4i.8xlarge',
//     'i3.8xlarge': 'i4i.16xlarge',
//     'i3.16xlarge': 'i4i.32xlarge',
//     'i3.metal': 'i4i.metal',
//     // 스토리지 최적화 i4i
//     'i4i.large': 'i4i.xlarge',
//     'i4i.xlarge': 'i4i.2xlarge',
//     'i4i.2xlarge': 'i4i.4xlarge',
//     'i4i.4xlarge': 'i4i.8xlarge',
//     'i4i.8xlarge': 'i4i.16xlarge',
//     'i4i.16xlarge': 'i4i.32xlarge',
//     'i4i.32xlarge': 'i4i.metal',
//     // 필요한 인스턴스 타입에 따라 매핑을 추가합니다.
//   };

//   // 현재 인스턴스 타입이 매핑 테이블에 있는지 확인하고, 상위 인스턴스 타입을 반환합니다.
//   if (instanceTypeMap.hasOwnProperty(currentInstanceType)) {
//     return instanceTypeMap[currentInstanceType];
//   }

//   // 매핑 테이블에 없는 경우, 직전 인스턴스 타입을 반환하거나 다른 로직을 추가할 수 있습니다.
//   return currentInstanceType;
// }
// function proposeLowerInstanceType(currentInstanceType) {
//   // 현재 인스턴스 타입에 따라 하위 인스턴스 타입을 결정합니다.
//   // 예시로 t2.small, t2.medium, t2.large, t2.xlarge의 하위 인스턴스 타입을 결정하도록 하겠습니다.
//   const instanceTypeMap = {
//     // 범용t, 세대업글부터
//     't2.micro': 't3.micro',
//     't2.small': 't3.small',
//     't2.medium': 't3.small',
//     't2.large': 't3.medium',
//     't2.xlarge': 't3.large',
//     't2.2xlarge': 't3.xlarge',
//     // 범용t
//     't3.micro': 't3.micro',
//     't3.small': 't3.small',
//     't3.medium': 't3.small',
//     't3.large': 't3.medium',
//     't3.xlarge': 't3.large',
//     't3.2xlarge': 't3.xlarge',
//     // 범용 m4, 세대업글부터
//     'm4.large': 'm6i.large',
//     'm4.xlarge': 'm6i.large',
//     'm4.2xlarge': 'm6i.xlarge',
//     'm4.4xlarge': 'm6i.2xlarge',
//     'm4.10xlarge': 'm6i.4xlarge',
//     'm4.16xlarge': 'm6i.8xlarge',
//     // 범용 m4, 세대업글부터
//     'm5.large': 'm6i.large',
//     'm5.xlarge': 'm6i.large',
//     'm5.2xlarge': 'm6i.xlarge',
//     'm5.4xlarge': 'm6i.2xlarge',
//     'm5.8xlarge': 'm6i.4xlarge',
//     'm5.12xlarge': 'm6i.8xlarge',
//     'm5.16xlarge': 'm6i.12xlarge',
//     'm5.24xlarge': 'm6i.16xlarge',
//     // 범용 m6
//     'm6i.large': 'm6i.large',
//     'm6i.xlarge': 'm6i.large',
//     'm6i.2xlarge': 'm6i.xlarge',
//     'm6i.4xlarge': 'm6i.2xlarge',
//     'm6i.8xlarge': 'm6i.4xlarge	',
//     'm6i.12xlarge	': 'm6i.8xlarge',
//     'm6i.16xlarge	': 'm6i.12xlarge',
//     'm6i.24xlarge': 'm6i.16xlarge',
//     'm6i.32xlarge': 'm6i.24xlarge',
//     'm6i.metal': 'm6i.32xlarge',
//     // 컴퓨팅 c4, 세대 업글부터
//     'c4.large': 'c5.large',
//     'c4.xlarge': 'c5.large',
//     'c4.2xlarge': 'c5.2xlarge',
//     'c4.4xlarge': 'c5.4xlarge',
//     'c4.8xlarge': 'c5.4xlarge',
//     // 컴퓨팅 c5, 세대 업글부터
//     'c5.large': 'c6i.large',
//     'c5.xlarge': 'c6i.large',
//     'c5.2xlarge': 'c6i.xlarge',
//     'c5.4xlarge': 'c6i.2xlarge',
//     'c5.9xlarge': 'c6i.4xlarge',
//     'c5.12xlarge': 'c6i.8xlarge',
//     'c5.18xlarge': 'c6i.12xlarge',
//     'c5.24xlarge': 'c6i.16xlarge',
//     // 컴퓨팅 c6
//     'c6i.large': 'c6i.large',
//     'c6i.xlarge': 'c6i.large',
//     'c6i.2xlarge': 'c6i.xlarge',
//     'c6i.4xlarge': 'c6i.2xlarge',
//     'c6i.8xlarge': 'c6i.4xlarge',
//     'c6i.12xlarge': 'c6i.8xlarge',
//     'c6i.16xlarge': 'c6i.12xlarge',
//     'c6i.24xlarge': 'c6i.16xlarge',
//     'c6i.32xlarge': 'c6i.24xlarge',
//     'c6i.metal': 'c6i.32xlarge',
//     // 메모리 r, 세대업글부터
//     'r4.large': 'r5.large',
//     'r4.xlarge': 'r5.large',
//     'r4.2xlarge': 'r5.xlarge',
//     'r4.4xlarge': 'r5.2xlarge',
//     'r4.8xlarge': 'r5.4xlarge',
//     'r4.16xlarge': 'r5.8xlarge',
//     // 메모리 r5
//     'r5.large': 'r5.large',
//     'r5.xlarge': 'r5.large',
//     'r5.2xlarge': 'r5.xlarge',
//     'r5.4xlarge': 'r5.2xlarge',
//     'r5.8xlarge': 'r5.4xlarge',
//     'r5.12xlarge': 'r5.8xlarge',
//     'r5.16xlarge': 'r5.12xlarge',
//     'r5.24xlarge': 'r5.16xlarge',
//     'r5.metal': 'r5.24xlarge',
//     // 메모리 r6
//     'r6i.large': 'r6i.large',
//     'r6i.xlarge': 'r6i.large',
//     'r6i.2xlarge': 'r6i.xlarge',
//     'r6i.4xlarge': 'r6i.2xlarge',
//     'r6i.8xlarge': 'r6i.4xlarge',
//     'r6i.12xlarge': 'r6i.8xlarge',
//     'r6i.16xlarge	': 'r6i.12xlarge',
//     'r6i.24xlarge': 'r6i.16xlarge',
//     'r6i.32xlarge': 'r6i.24xlarge',
//     // 가속화 컴퓨팅 p, 세대업글부터
//     'p3.2xlarge': 'p4d.24xlarge',
//     'p3.8xlarge': 'p4d.24xlarge',
//     'p3.16xlarge': 'p4d.24xlarge',
//     'p3dn.24xlarge': 'p4d.24xlarge',
//     // 가속화 컴푸팅 p
//     'p4d.24xlarge': 'p4de.24xlarge',
//     // 스토리지 최적화 i3en, 세대업글부터
//     'i3en.large': 'i4i.large',
//     'i3en.xlarge': 'i4i.large',
//     'i3en.2xlarge': 'i4i.xlarge',
//     'i3en.3xlarge': 'i4i.2xlarge',
//     'i3en.6xlarge': 'i4i.4xlarge',
//     'i3en.12xlarge': 'i4i.8xlarge',
//     'i3en.24xlarge': 'i4i.16xlarge',
//     'i3en.metal': 'i4i.32xlarge',
//     // 스토리지 최적화 i3, 세대 업글부터
//     'i3.large': 'i4i.large',
//     'i3.xlarge': 'i4i.large',
//     'i3.2xlarge': 'i4i.xlarge',
//     'i3.4xlarge': 'i4i.2xlarge',
//     'i3.8xlarge': 'i4i.4xlarge',
//     'i3.16xlarge': 'i4i.8xlarge',
//     'i3.metal': 'i4i.32xlarge',
//     // 스토리지 최적화 i4i
//     'i4i.large': 'i4i.large',
//     'i4i.xlarge': 'i4i.large',
//     'i4i.2xlarge': 'i4i.xlarge',
//     'i4i.4xlarge': 'i4i.2xlarge',
//     'i4i.8xlarge': 'i4i.4xlarge',
//     'i4i.16xlarge': 'i4i.8xlarge',
//     'i4i.32xlarge': 'i4i.32xlarge',
//     // 필요한 인스턴스 타입에 따라 매핑을 추가합니다.
//   };

//   // 현재 인스턴스 타입이 매핑 테이블에 있는지 확인하고, 하위 인스턴스 타입을 반환합니다.
//   if (instanceTypeMap.hasOwnProperty(currentInstanceType)) {
//     return instanceTypeMap[currentInstanceType];
//   }
//   return currentInstanceType;
// }
// function proposeNowInstanceType(currentInstanceType) {
//    // 범용t, 세대업글부터
//   const instanceTypeMap = {
//     't2.micro': 't3.micro',
//     't2.small': 't3.small',
//     't2.medium': 't3.medium',
//     't2.large': 't3.large',
//     't2.xlarge': 't3.xlarge',
//     't2.2xlarge': 't3.2xlarge',
//     // 범용 m, 세대업글부터
//     'm4.large': 'm6i.large',
//     'm4.xlarge': 'm6i.xlarge',
//     'm4.2xlarge': 'm6i.2xlarge',
//     'm4.4xlarge': 'm6i.4xlarge',
//     'm4.10xlarge': 'm6i.12xlarge',
//     'm4.16xlarge': 'm6i.16xlarge',
//      // 범용 m5, 세대업글부터
//     'm5.large': 'm6i.large',
//     'm5.xlarge': 'm6i.xlarge',
//     'm5.2xlarge': 'm6i.2xlarge',
//     'm5.4xlarge': 'm6i.4xlarge',
//     'm5.8xlarge': 'm6i.8xlarge',
//     'm5.12xlarge': 'm6i.12xlarge',
//     'm5.16xlarge': 'm6i.16xlarge',
//     'm5.24xlarge': 'm6i.24xlarge',
//     // 컴퓨팅 c4, 세대 업글부터
//     'c4.large': 'c6i.large',
//     'c4.xlarge': 'c6i.xlarge',
//     'c4.2xlarge': 'c6i.2xlarge',
//     'c4.4xlarge': 'c6i.4xlarge',
//     'c4.8xlarge': 'c6i.8xlarge',
//     // 컴퓨팅 c5, 세대 업글부터
//     'c5.large': 'c6i.large',
//     'c5.xlarge': 'c6i.xlarge',
//     'c5.2xlarge': 'c6i.2xlarge',
//     'c5.4xlarge': 'c6i.4xlarge',
//     'c5.9xlarge': 'c6i.12xlarge',
//     'c5.12xlarge': 'c6i.12xlarge',
//     'c5.18xlarge': 'c6i.24xlarge',
//     'c5.24xlarge': 'c6i.24xlarge',
//     // 메모리 r4, 세대업글부터
//     'r4.large': 'r6i.large',
//     'r4.xlarge': 'r6i.xlarge',
//     'r4.2xlarge': 'r6i.2xlarge',
//     'r4.4xlarge': 'r6i.4xlarge',
//     'r4.8xlarge': 'r6i.8xlarge',
//     'r4.16xlarge': 'r6i.16xlarge',
//     // 메모리 r5, 세대업글부터
//     'r5.large': 'r6i.large',
//     'r5.xlarge': 'r6i.xlarge',
//     'r5.2xlarge': 'r6i.2xlarge',
//     'r5.4xlarge': 'r6i.4xlarge',
//     'r5.8xlarge': 'r6i.8xlarge',
//     'r5.12xlarge': 'r6i.12xlarge',
//     'r5.16xlarge': 'r6i.16xlarge',
//     'r5.24xlarge': 'r6i.24xlarge',
//     // 가속화 컴퓨팅 p, 세대업글부터
//     'p3.2xlarge': 'p4d.24xlarge',
//     'p3.8xlarge': 'p4d.24xlarge',
//     'p3.16xlarge': 'p4d.24xlarge',
//     'p3dn.24xlarge': 'p4d.24xlarge',
//     // 스토리지 최적화 i3en, 세대업글부터
//     'i3en.large': 'i4i.large',
//     'i3en.xlarge': 'i4i.xlarge',
//     'i3en.2xlarge': 'i4i.2xlarge',
//     'i3en.3xlarge': 'i4i.4xlarge',
//     'i3en.6xlarge': 'i4i.8xlarge',
//     'i3en.12xlarge': 'i4i.16xlarge',
//     'i3en.24xlarge': 'i4i.32xlarge',
//     'i3en.metal': 'i4i.metal',
//     // 스토리지 최적화 i3, 세대 업글부터
//     'i3.large': 'i4i.large',
//     'i3.xlarge': 'i4i.xlarge',
//     'i3.2xlarge': 'i4i.2xlarge',
//     'i3.4xlarge': 'i4i.4xlarge',
//     'i3.8xlarge': 'i4i.8xlarge',
//     'i3.16xlarge': 'i4i.16xlarge',
//     'i3.metal': 'i4i.metal',
//   }

//   if (instanceTypeMap.hasOwnProperty(currentInstanceType)) {
//     return instanceTypeMap[currentInstanceType];
//   }
//   return currentInstanceType;
// }

module.exports = router;
