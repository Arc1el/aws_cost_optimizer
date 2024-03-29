$(document).ready(function() {
    var socket = io();
  
    socket.emit('test', "hello");
    socket.on('test', function(data){
        console.log(data);
    });
    socket.on('console_logger', function(data){
      console.log(data);
    })
    
    var rds_total_length = 0;
    var rds_total_data = [];
    socket.on('opt_rds_list', function (data){
      var total_length = data.total_length;
      rds_total_length += total_length;
      var now_length = data.length;
      var estimated_time = parseFloat(data.estimated / 1000).toFixed(2) + " Seconds";
      var spanEle = document.getElementById('loadingspan');
      spanEle.innerHTML = `<br><img src='./loading.gif' width='15px'/> Generating Tables .... In Progress : ${now_length}/${total_length} .... Estimated Time : ${estimated_time}<br>`;
      
      var loadingDiv = document.getElementById('loadingdiv');
      loadingDiv.style.margin = "5px";
      loadingDiv.style.backgroundColor = "#265E9A";
  
      // Calculate the width transition duration based on the total length
      var transitionDuration = total_length * 200 + "ms"; // Adjust the duration as per your preference
      
      // Apply transition style to the loadingDiv
      loadingDiv.style.transition = "width " + transitionDuration + " ease";
  
      // Use setTimeout to delay the width adjustment and trigger the animation
      setTimeout(function() {
          loadingDiv.style.width = `calc(${now_length}/${total_length} * 98%)`; 
      }, 0);
    });

    $("#ok_btn").on("click", show);
    $("#down_csv").on("click", downloadTablesAsCSV);
  
    const regions_str = 
      {
        "0" : "Africa (Cape Town) af-south-1",
        "1" : "Asia Pacific (Hong Kong) ap-east-1",
        "2" : "Asia Pacific (Tokyo) ap-northeast-1",
        "3" : "Asia Pacific (Seoul) ap-northeast-2",
        "4" : "Asia Pacific (Osaka) ap-northeast-3",
    
        "5" : "Asia Pacific (Mumbai) ap-south-1",
        "6" : "Asia Pacific (Hyderabad) ap-south-2",
        "7" : "Asia Pacific (Singapore) ap-southeast-1",
        "8" : "Asia Pacific (Sydney) ap-southeast-2",
        "9" : "Asia Pacific (Jakarta) ap-southeast-3",
    
        "10" : "Asia Pacific (Melbourne) ap-southeast-4",
        "11" : "Canada (Central) ca-central-1", 
        "12" : "EU (Frankfurt) eu-central-1", 
        "13" : "EU (Zurich) eu-central-2", 
        "14" : "EU (Stockholm) eu-north-1",
        
        "15" : "EU (Milan) eu-south-1", 
        "16" : "EU (Spain) eu-south-2", 
        "17" : "EU (Ireland) eu-west-1",
        "18" : "EU (London) eu-west-2",
        "19" : "EU (Paris) eu-west-3",
    
        "20" : "Middle East (UAE) me-central-1",
        "21" : "Middle East (Bahrain) me-south-1",
        "22" : "South America (Sao Paulo) sa-east-1",
        "23" : "US East (N. Virginia) us-east-1",
        "24" : "US East (Ohio) us-east-2",
    
        "25" : "US West (N. California) us-west-1",
        "26" : "US West (Oregon) us-west-2" 
      }
  
    const container = document.getElementById("checkboxContainer");
    const table = document.createElement("table");
    table.classList.add("checkbox");
    container.appendChild(table);
  
    let row;
    let count = 0;
  
    numbers = [];
  
    for (const key in regions_str) {
      if (count % 3 === 0) {
        row = document.createElement("tr");
        table.appendChild(row);
      }
  
      const cell = document.createElement("td");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = key;
      checkbox.addEventListener("change", function() {
        const keyValue = parseInt(this.value);
        const index = numbers.indexOf(keyValue);
        console.log("change");
  
        if (this.checked && index === -1) {
          numbers.push(keyValue);
        } else if (!this.checked && index > -1) {
          numbers.splice(index, 1);
        }
      });
      cell.appendChild(checkbox);
  
      const label = document.createElement("label");
      label.innerHTML = regions_str[key];
      label.addEventListener("click", function() {
        checkbox.checked = !checkbox.checked;
        console.log("change2");
        const keyValue = parseInt(checkbox.value);
        const index = numbers.indexOf(keyValue);
  
        if (checkbox.checked && index === -1) {
          numbers.push(keyValue);
        } else if (!checkbox.checked && index > -1) {
          numbers.splice(index, 1);
        }
      });
      cell.appendChild(label);
      row.appendChild(cell);
      count++;
    }
  
    const toggleButton = document.getElementById("toggleButton");
    toggleButton.innerHTML = "Toggle Checkboxes";
    toggleButton.addEventListener("click", function() {
      const checkboxes = document.querySelectorAll("input[type='checkbox']");
      checkboxes.forEach(function(checkbox) {
        checkbox.checked = !checkbox.checked;
  
        const keyValue = parseInt(checkbox.value);
        const index = numbers.indexOf(keyValue);
  
        if (checkbox.checked && index === -1) {
          numbers.push(keyValue);
        } else if (!checkbox.checked && index > -1) {
          numbers.splice(index, 1);
        }
      });
    });
  
    header_flag = true;
    function createCostTable(data, number){
      var role = document.getElementById("rolearn").value;
      var now_total_cost = 0;
      var proposed_total_cost = 0;
  
      data.forEach(function(item) {
        gen_flag = true;
        count = 0;
        id = "";
        cost = 0;
        
        var tr = document.createElement("tr");
        
        for (var key in item) {
          //console.log(item["maxCpuUsage"])
          if (item["maxCpuUsage"] === "0 %"){
            //console.log("zero CPU deleted")
            gen_flag = false;
            continue;
          }
          else{
            
            gen_flag = true;
            if (item.hasOwnProperty(key)) {
              count ++
              if (count == 5){
                cost = parseFloat(item[key]) * 720;
                now_total_cost += cost;
              }
              if (count == 7){
                cost = parseFloat(item[key]) * 720;
                proposed_total_cost += cost;
              }
            }
          }
        }
      }); 
  
      var header1 = document.createElement("th");
      header1.textContent = "리전";
      var header2 = document.createElement("th");
      header2.textContent = "인스턴스 갯수";
      var header3 = document.createElement("th");
      header3.textContent = "현재 총 인스턴스 비용";
      var header4 = document.createElement("th");
      header4.textContent = "추천 타입 적용시 비용";
      var header5 = document.createElement("th");
      header5.textContent = "총 절감액 (720시간 기준)";
  
      var tbody = document.createElement("tbody");
      var row1 = document.createElement("tr");
  
      var data1 = document.createElement("td");
      data1.innerHTML = regions_str[number];
      var data2 = document.createElement("td");
      data2.textContent = data.length;
      var data3 = document.createElement("td");
      data3.textContent = parseFloat(now_total_cost).toFixed(2);
      var data4 = document.createElement("td");
      data4.textContent = parseFloat(proposed_total_cost).toFixed(2);
      var data5 = document.createElement("td");
      data5.textContent = parseFloat(now_total_cost - proposed_total_cost).toFixed(2); 
  
      var colgroup = document.createElement('colgroup');
  
      // 각 칸의 너비 비율 설정
      var col1 = document.createElement('col');
      col1.style.width = '30%';
  
      var col2 = document.createElement('col');
      col2.style.width = '10%';
  
      var col3 = document.createElement('col');
      col3.style.width = '20%';
  
      var col4 = document.createElement('col');
      col4.style.width = '20%';
  
      var col5 = document.createElement('col');
      col5.style.width = '20%';
  
      
  
      colgroup.appendChild(col1);
      colgroup.appendChild(col2);
      colgroup.appendChild(col3);
      colgroup.appendChild(col4);
      colgroup.appendChild(col5);
  
      if (header_flag){
        var costTable = document.createElement("table");
        costTable.id = "costTable"
        var thead = document.createElement("thead");
        var headerRow = document.createElement("tr");
        var tbody = document.createElement("tbody");
  
        costTable.appendChild(tbody);
        costTable.appendChild(colgroup);
        
        headerRow.appendChild(header1);
        headerRow.appendChild(header2);
        headerRow.appendChild(header3);
        headerRow.appendChild(header4);
        headerRow.appendChild(header5);
        thead.appendChild(headerRow);
        costTable.appendChild(thead);
        header_flag = false; 
      }
      else {
        var costTable = document.getElementById("costTable");
        var tbody = document.createElement("tbody");
        costTable.appendChild(tbody);
        costTable.appendChild(colgroup);
      } 
  
      
      row1.appendChild(data1);
      row1.appendChild(data2);
      row1.appendChild(data3);
      row1.appendChild(data4);
      row1.appendChild(data5);
      tbody.appendChild(row1);
      costTable.appendChild(tbody);
      costTable.classList.add("table", "costTable");
      costTable.classList.add("csv");
  
      if (data.length = 0){
        return false;
      }
      else{
        return costTable;
      }  
    }
  
    function createTable(data) {
      var role = document.getElementById("rolearn").value;
      var table = document.createElement("table");
      table.classList.add("table");
      var id = document.getElementById("rolearn").value;
      var thead = document.createElement("thead");
      var tr = document.createElement("tr");
    
      // Set table headers
      var headers = ["리전", "DB 네임", "인스턴스 유형", "엔진", "엔진버전", "AZ", "2주 CPU", "2주 Free MEM", "2주 읽기지연", "2주 쓰기지연", "메트릭 차트"];
      headers.forEach(function (header) {
        var th = document.createElement("th");
        th.textContent = header;
        tr.appendChild(th);
      });
    
      thead.appendChild(tr);
      table.appendChild(thead);
    
      var tbody = document.createElement("tbody");
      data.forEach(function (item) {
        gen_flag = true;
        count = 0;
        id = "";
        metric = "";
        var tr = document.createElement("tr");
        for (var key in item) {
          if (item.hasOwnProperty(key)) {
            count++
            if (count == 2) {
              id = item[key];
              //console.log(id)
            }
            var td = document.createElement("td");
            td.textContent = item[key];
            tr.appendChild(td);
          }
        }
        var chart_div = document.createElement("div");
        var chart = document.createElement("td");
    
        var image1 = document.createElement("img");
        var img1_src = "/" + role + "/" + id + "/cpu_chart.png"
        image1.src = img1_src;
        image1.alt = "No Data";
        image1.style.maxWidth = "100%";
        image1.style.height = "auto";
    
        var image2 = document.createElement("img");
        var img2_src = "/" + role + "/" + id + "/memory_chart.png"
        image2.src = img2_src;
        image2.alt = "No Data";
        image2.style.maxWidth = "100%";
        image2.style.height = "auto";
    
        var image3 = document.createElement("img");
        var img3_src = "/" + role + "/" + id + "/read_latency_chart.png"
        image3.src = img3_src;
        image3.alt = "No Data";
        image3.style.maxWidth = "100%";
        image3.style.height = "auto";
    
        var image4 = document.createElement("img");
        var img4_src = "/" + role + "/" + id + "/write_latency_chart.png"
        image4.src = img4_src;
        image4.alt = "No Data";
        image4.style.maxWidth = "100%";
        image4.style.height = "auto";
    
        window.addEventListener("resize", function () {
          var tableWidth = imageTable.offsetWidth;
          var cellWidth = tableWidth;
          var maxWidth = "100%";
        
          // Resize images
          image1.style.maxWidth = maxWidth;
          image2.style.maxWidth = maxWidth;
          image3.style.maxWidth = maxWidth;
          image4.style.maxWidth = maxWidth;
        
          // Resize cells
          imageCell1.style.width = cellWidth + "px";
          imageCell2.style.width = cellWidth + "px";
          imageCell3.style.width = cellWidth + "px";
          imageCell4.style.width = cellWidth + "px";
        });
    
        var imageTable = document.createElement("table"); // 2x2 이미지 테이블
        var imageTbody = document.createElement("tbody");
    
        var imageRow1 = document.createElement("tr");
        var imageRow2 = document.createElement("tr");
    
        var imageCell1 = document.createElement("td");
        var imageCell2 = document.createElement("td");
        var imageCell3 = document.createElement("td");
        var imageCell4 = document.createElement("td");
    
        imageCell1.appendChild(image1);
        imageCell2.appendChild(image2);
        imageRow1.appendChild(imageCell1);
        imageRow1.appendChild(imageCell2);
    
        imageCell3.appendChild(image3);
        imageCell4.appendChild(image4);
        imageRow2.appendChild(imageCell3);
        imageRow2.appendChild(imageCell4);
    
        imageTbody.appendChild(imageRow1);
        imageTbody.appendChild(imageRow2);
        imageTable.appendChild(imageTbody);
        chart.appendChild(imageTable);
        tr.appendChild(chart);
    
        if (gen_flag) {
          tbody.appendChild(tr);
        }
      });
      table.appendChild(tbody);
      // table.appendChild(colgroup);
      table.classList.add("csv");
    
      return table;
    }    
  
    async function show() {
      var role = document.getElementById("rolearn").value;
      var tableContainer = document.getElementById("rdsTableContainer");
      var costContainer = document.getElementById("rdsTotalCostContainer");
    
    
      for (const number of numbers) {
        console.log("number: " + number);
    
        const spanEle = document.createElement('span');
        spanEle.id = "loadingspan";
        spanEle.innerHTML = "<br><img src='./loading.gif' width='15px'/> Generating Tables .... This job can take a few minutes if memory usage data exists....<br>"
        const loadingDiv = document.createElement('div');
        loadingDiv.id = "loadingdiv"
        loadingDiv.style.margin = "5px"
        loadingDiv.style.height = "10px";
        loadingDiv.style.backgroundColor = "#265E9A";
        costContainer.insertBefore(loadingDiv, costContainer.firstChild);
        costContainer.insertBefore(spanEle, costContainer.firstChild);
    
        await new Promise((resolve, reject) => {
          socket.emit("rds_opt_req", {number, role});
          socket.once("send_opted_rds", (data) => {
            var instances = JSON.parse(data);
            rds_total_data = rds_total_data.concat(instances);
            var table = createTable(instances);
            if (
              table &&
              table.tBodies.length > 0 &&
              table.tBodies[0].rows.length > 0
            ) {
              tableContainer.appendChild(table);
            } else {
              // console.log("테이블에 내용이 없습니다.");
            }
            // var costTable = createCostTable(instances, number);
            // costContainer.appendChild(costTable);
    
            if (costContainer.firstChild instanceof HTMLSpanElement) {
              costContainer.removeChild(costContainer.firstChild);
              costContainer.removeChild(costContainer.firstChild);
            }
            resolve();
          });
        });
      }
      // All sequential operations completed
      // console.log("모든 비동기 작업 완료");
      console.log(rds_total_data);
      document.getElementById('canvasContainer').style.display='flex';
      var regionCount = {};
      var classCount = {};
      var engineCount = {};
      rds_total_data.forEach(item => {
        if (regionCount[item.Region]) {
          regionCount[item.Region]++;
        } else {
          regionCount[item.Region] = 1;
        }

        if (classCount[item.DBInstanceClass]) {
          classCount[item.DBInstanceClass]++;
        } else {
          classCount[item.DBInstanceClass] = 1;
        }

        if (engineCount[item.Engine]) {
          engineCount[item.Engine]++;
        } else {
          engineCount[item.Engine] = 1;
        }
      });

      var labels = Object.keys(regionCount);
      var values = Object.values(regionCount);
      var ctx = document.getElementById('regionChart').getContext('2d');
      new Chart(ctx, {
        type: 'pie',
        data: {
          labels: labels,
          datasets: [{
            label: 'Region Count',
            data: values,
            backgroundColor: [
              '#8e9aaf',
              '#cbc0d3',
              "#efd3d7",
              "#feeafa",
              '#dee2ff', 
              // Add more colors if needed
            ],
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          title: {
            display: true,
            text: 'Region Count'
          },
          legend: {
            display: true,
            position: 'right',
            labels: {
              filter: function (legendItem, chartData) {
                return chartData.datasets[legendItem.datasetIndex].labelIndex < 5;
              }
            }
          }
        }
      });
      
      var labels2 = Object.keys(classCount);
      var values2 = Object.values(classCount);
      var ctx = document.getElementById('instanceChart').getContext('2d');
      new Chart(ctx, {
        type: 'pie',
        data: {
          labels: labels2,
          datasets: [{
            label: 'Instance Type Count',
            data: values2,
            backgroundColor: [
              '#8e9aaf',
              '#cbc0d3',
              "#efd3d7",
              "#feeafa",
              '#dee2ff', 
              // Add more colors if needed
            ],
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          title: {
            display: true,
            text: 'Instance Type Count'
          },
          legend: {
            display: true,
            position: 'right',
            labels: {
              filter: function (legendItem, chartData) {
                return chartData.datasets[legendItem.datasetIndex].labelIndex < 5;
              }
            }
          }
        }
      });

      var labels3 = Object.keys(engineCount);
      var values3 = Object.values(engineCount);
      var ctx = document.getElementById('engineChart').getContext('2d');
      new Chart(ctx, {
        type: 'pie',
        data: {
          labels: labels3,
          datasets: [{
            label: 'Engine Count',
            data: values3,
            backgroundColor: [
              '#8e9aaf',
              '#cbc0d3',
              "#efd3d7",
              "#feeafa",
              '#dee2ff', 
              // Add more colors if needed
            ],
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          title: {
            display: true,
            text: 'Engine Count'
          },
          legend: {
            display: true,
            position: 'right',
            labels: {
              filter: function (legendItem, chartData) {
                return chartData.datasets[legendItem.datasetIndex].labelIndex < 5;
              }
            }
          }
        }
      });
    }
    
    function downloadTablesAsCSV() {
      var tableClass = 'csv'
      var filename = 'result.csv'
      var tables = document.getElementsByClassName(tableClass);
      var csvContent = "";
      for (var i = 0; i < tables.length; i++) {
        var rows = [];
        for (var j = 1; j < tables[i].rows.length; j++) {
          var row = [];
          for (var k = 0; k < tables[i].rows[j].cells.length; k++) {
            var cellData = tables[i].rows[j].cells[k].textContent;
            if (cellData.includes(",")) {
              // 데이터에 쉼표가 포함된 경우 따옴표로 감싸기
              cellData = '"' + cellData + '"';
            }
            row.push(cellData);
          }
          rows.push(row);
        }
        for (var j = 0; j < rows.length; j++) {
          csvContent += rows[j].join(",") + "\n";
        }
      }
  
      // UTF-8로 인코딩
      var encoder = new TextEncoder();
      var csvData = encoder.encode(csvContent);
  
      // CSV 파일로 다운로드
      var blob = new Blob([csvData], { type: "text/csv" });
      if (navigator.msSaveBlob) {
        navigator.msSaveBlob(blob, filename);
      } else {
        var link = document.createElement("a");
        if (link.download !== undefined) {
          var url = URL.createObjectURL(blob);
          link.setAttribute("href", url);
          link.setAttribute("download", filename);
          link.style.visibility = "hidden";
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
      }
    }
  });