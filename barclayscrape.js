var config = require("./config");

function login(casper, loginOpts) {
    loginOpts = loginOpts || {};
    if (casper.cli.has("otp")) {
        loginOpts.otp = String(casper.cli.get('otp'));
    } else if (casper.cli.has("pcode") && casper.cli.has("mcode")) {
        loginOpts.pcode = String(casper.cli.get('pcode'));
        loginOpts.mcode = String(casper.cli.get('mcode'));
    } else {
        casper.echo('Identify with mobile pin sentry: ', 'INFO');
        loginOpts.motp = require('system').stdin.readLine();
    }

    casper.on('error', function(msg, backtrace) {
        this.capture('error.png');
        this.die(msg, 1);
    });
    casper.userAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.49 Safari/537.36');

    casper.on('remote.message', function(msg) {
        this.log('console message: ' + msg, 'debug');
    });
    casper.on("page.error", function(msg, backtrace) {
        this.log('JS error: ' + msg, 'debug');
        this.log(JSON.stringify(backtrace), 'debug');
    });
    casper.thenOpen('https://bank.barclays.co.uk/olb/authlogin/loginAppContainer.do', function loginStageOne() {
        this.log("Login stage 1");
        var part1, part2;
        if (loginOpts.motp) {
            part1 = loginOpts.motp.slice(0, 4);
            part2 = loginOpts.motp.slice(4, 8);
        } else if (config.card_digits && loginOpts.otp) {
            part1 = loginOpts.otp.slice(0, 4);
            part2 = loginOpts.otp.slice(4, 8);
        } else if (!(loginOpts.mcode && loginOpts.pcode)) {
            this.die("Please provide card_digits, plus either otp or motp (or pcode and mcode)", 3);
        }

        this.waitForSelector('input#membershipNum0', function loginStageOneA() {
            this.fill('form[name="loginStep1"]', {
                'surname': config.surname,
                'membershipNum': config.membership_number
            });
            this.click('button[title="Next Step"]');
        });

        // 2017-08 update: This needs a selector for the passcode/memorable word login method adding
        // (comma-separated list):
        this.waitForSelector('input#radio-c3,input#radio-c4,input#pinsentryCode0,input#mobilePinsentryCode0',
                                function loginStageTwoA() {
            // This is either the login screen, or a page to select the login method
            this.log("Login stage 2");

            // Select the login method
            if (loginOpts.motp) {
                if (this.exists("input#radio-c3")) {
                    this.click('input#radio-c3');
                }
            } else {
                if (this.exists("input#radio-c4")) {
                    this.click('input#radio-c4');
                }
            }
        });

        this.waitForSelector('input#pinsentryCode0,input#mobilePinsentryCode0', function loginStageTwo() {
            // This is the main login screen.
            if (loginOpts.pcode && loginOpts.mcode) {
                // log in via passcode and memorable password
                // 2017-08 update: This will need updating for the new form (which I can't see)
                this.log("Attempting to log in non-interactively");
                if (this.exists("fieldset.letter-select legend strong")) {
                    // parse the two requested indices (ie, "1st " and "12th") from memorable password
                    var indices = this.evaluate(function getIndices() {
                        var digits = /^[0-9]{1,2}/;
                        return [
                            document.querySelector("fieldset.letter-select legend strong:nth-of-type(1)").innerText.match(digits),
                            document.querySelector("fieldset.letter-select legend strong:nth-of-type(2)").innerText.match(digits)
                        ];
                    });
                    
                    // ensure both indices are valid and adjust to 0-based
                    for (var i=0; i<2; i++) {
                        indices[i]--;
                        if ((indices[i] === null) || (indices[i] < 0)) {
                            this.capture("login-error.png");
                            this.die("Failed to parse requested memorable password indices. Screenshot saved to login-error.png.", 2);
                        }

                        if (indices[i] >= loginOpts.mcode.length) {
                            this.capture("login-error.png");
                            this.die("Requested char: "+ indices[i].toString() +" exceeded length of supplied mcode: "+loginOpts.mcode.length.toString()+". Screenshot saved to login-error.png.", 2);
                        }
                    }
                    
                    // extract the two requested characters from memorable password
                    var chars = [loginOpts.mcode.substring(indices[0], indices[0]+1), loginOpts.mcode.substring(indices[1],indices[1]+1)];
                    if (this.exists('#passcode-radio')) {
                        this.click("#passcode-radio");
                    }
                    this.fill('form#accordion-bottom-form', {
                        'passcode': loginOpts.pcode,
                        'firstMemorableCharacter': chars[0],
                        'secondMemorableCharacter': chars[1]
                    });
                    this.click('button#log-in-to-online-banking2');
                }
                else
                {
                    this.capture("login-error.png");
                    this.die("Could not find option to log in via memorable password. Check your account is setup to allow this.. Screenshot saved to login-error.png.", 2);
                }
            } else {
                if (loginOpts.motp) {
                    this.sendKeys('input#mobilePinsentryCode0', part1);
                    this.sendKeys('input#mobilePinsentryCode1', part2);
                } else {
                    this.sendKeys('input#lastDigits0', config.card_digits);
                    this.sendKeys('input#pinsentryCode0', part1);
                    this.sendKeys('input#pinsentryCode1', part2);
                }
            }
            this.click('button[title="Log in to Online Banking"]');
        }, function loginStageTwoTimeout() {
            this.capture("login-error.png");
            this.debugHTML();
            this.die("Login stage 2 timeout. Screenshot saved to login-error.png.", 2);
        }, 10000);
    });

    casper.then(function completeLogin() {
        this.log("Waiting to be logged in", "debug");
        this.waitForSelector('a#logout', function waitForLogin() {
            this.echo("Successfully logged in", "INFO");
            if (loginOpts.onLogin) {
                loginOpts.onLogin();
            }
            if (loginOpts.onAccounts) {
                fetchAccounts(this, loginOpts.onAccounts);
            }
        }, function loginTimeout(response) {
            this.capture("login-error.png");
            this.echo("Surname: " + config.surname);
            this.echo("Membership number: " + config.membership_number);
            this.echo("Card digits: " + config.card_digits);
            this.die("Login timeout. Check credentials. Screenshot saved to login-error.png.", 2);
        }, 10002);
    });
}

// Obtain a list of all accounts
function fetchAccounts(casper, then) {
    if (config.accounts) {
        then(config.accounts);
    } else {
        casper.then(function fetchAccountList() {
            var accounts = {};
            var account_list = this.evaluate(function() {
                var nodes = document.querySelectorAll("li.account");
                var account_nodes = [].filter.call(nodes, function(node) {
                    var product = node.getAttribute("data-product-class");
                    // Filter to only include current and savings accounts
                    return product == "CU" || product == "SV";
                });
                return [].map.call(account_nodes, function(node) {
                    var id = node.id.substr(1);
                    var product = node.querySelectorAll("span.edit-account-form")[0].getAttribute("data-product-identifier");
                    return [id, product];
                });
            });
            this.each(account_list, function (self, acct) {
                accounts[acct[0]] = acct[1];
            });
            then(accounts);
        });
    }
}

module.exports = {login: login};
