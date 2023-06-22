var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var favicon = require('serve-favicon'); 


var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
var ec2Router = require('./routes/ec2');
var rdsRouter = require('./routes/rds');

// auto error handling using express-async-errors
require('express-async-errors');

var app = express();
app.io = require('socket.io')();


// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.engine('html', require('ejs').renderFile);

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'chart')));
app.use(express.static(path.join(__dirname, 'rds_chart')));

app.use(favicon(path.join(__dirname, 'public',  'favicon.ico')));


app.use('/', indexRouter);
app.use('/users', usersRouter);
app.use('/api', ec2Router, rdsRouter);
// app.use('/api', rdsRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

// EC2 Optimization Moudle
var EC2 = require('./modules/ec2opt');
// RDS Optimization Moudle
var RDS = require('./modules/rdsopt');

app.io.on('connection', async (socket) => {
  try{
    console.log("socket connection established");
    socket.on('disconnect', () =>{
      console.log("socket disconnected");
      socket.emit('log_health', () => {
        return "socket";
      })
    });

    socket.on('test', (data) => {
      EC2.test({socket, data});
    });

    socket.on('ec2_opt_req', (data) => {
      EC2.opt({socket, data});
    })

    socket.on('rds_opt_req', (data) => {
      RDS.opt({socket, data});
    })

  }catch (e) {
    logger.logging(e);
    console.error(e);
  }finally {}
});

module.exports = app;
